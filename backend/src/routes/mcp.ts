import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDbForDomain } from '../db/app-db-router.js';
import { writeAuditLog } from '../services/audit-logger.js';
import {
  connectServer,
  disconnectServer,
  getConnectedServers,
  getServerTools,
  isConnected,
  type McpServerConfig,
} from '../services/mcp-manager.js';

// ─── Zod Schemas ────────────────────────────────────────────────────────

const McpServerCreateSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with hyphens/underscores'),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().optional(),
  url: z.string().url().optional(),
  args: z.string().optional(),   // JSON array string
  env: z.string().optional(),    // JSON object string
  enabled: z.boolean().default(true),
  disabled_tools: z.string().optional(), // JSON array string
});

const McpServerUpdateSchema = McpServerCreateSchema.partial();

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// ─── Helpers ────────────────────────────────────────────────────────────

async function getServerById(id: number): Promise<McpServerConfig | undefined> {
  const mcpDb = getDbForDomain('mcp');
  const row = await mcpDb.queryOne<McpServerConfig>('SELECT * FROM mcp_servers WHERE id = ?', [id]);
  return row ?? undefined;
}

async function getAllServers(): Promise<McpServerConfig[]> {
  const mcpDb = getDbForDomain('mcp');
  return mcpDb.query<McpServerConfig>('SELECT * FROM mcp_servers ORDER BY name ASC');
}

// ─── Routes ─────────────────────────────────────────────────────────────

export async function mcpRoutes(fastify: FastifyInstance) {
  // List all configured MCP servers with connection status
  fastify.get('/api/mcp/servers', {
    schema: {
      tags: ['MCP'],
      summary: 'List configured MCP servers',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    const servers = await getAllServers();
    const connectedStatuses = getConnectedServers();
    const connectedMap = new Map(connectedStatuses.map(s => [s.name, s]));

    return servers.map(server => ({
      ...server,
      args: server.args ?? null,
      env: server.env ?? null,
      disabled_tools: server.disabled_tools ?? null,
      connected: isConnected(server.name),
      toolCount: connectedMap.get(server.name)?.toolCount ?? 0,
      connectionError: connectedMap.get(server.name)?.error ?? null,
    }));
  });

  // Add a new MCP server config
  fastify.post('/api/mcp/servers', {
    schema: {
      tags: ['MCP'],
      summary: 'Add a new MCP server',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const parsed = McpServerCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const body = parsed.data;
    const mcpDb = getDbForDomain('mcp');

    // Validate transport-specific requirements
    if (body.transport === 'stdio' && !body.command) {
      return reply.code(400).send({ error: 'stdio transport requires a command' });
    }
    if ((body.transport === 'sse' || body.transport === 'http') && !body.url) {
      return reply.code(400).send({ error: `${body.transport} transport requires a URL` });
    }

    // Validate JSON fields if provided
    if (body.args) {
      try { JSON.parse(body.args); } catch {
        return reply.code(400).send({ error: 'args must be a valid JSON array' });
      }
    }
    if (body.env) {
      try { JSON.parse(body.env); } catch {
        return reply.code(400).send({ error: 'env must be a valid JSON object' });
      }
    }
    if (body.disabled_tools) {
      try { JSON.parse(body.disabled_tools); } catch {
        return reply.code(400).send({ error: 'disabled_tools must be a valid JSON array' });
      }
    }

    try {
      const result = await mcpDb.execute(
        `INSERT INTO mcp_servers (name, transport, command, url, args, env, enabled, disabled_tools)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.name,
          body.transport,
          body.command ?? null,
          body.url ?? null,
          body.args ?? null,
          body.env ?? null,
          body.enabled ? 1 : 0,
          body.disabled_tools ?? null,
        ],
      );

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'mcp.server.create',
        target_type: 'mcp_server',
        target_id: body.name,
        details: { transport: body.transport },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return reply.code(201).send({
        id: result.lastInsertRowid,
        ...body,
        enabled: body.enabled ? 1 : 0,
      });
    } catch (err: any) {
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return reply.code(409).send({ error: `Server with name "${body.name}" already exists` });
      }
      throw err;
    }
  });

  // Update an MCP server config
  fastify.put('/api/mcp/servers/:id', {
    schema: {
      tags: ['MCP'],
      summary: 'Update an MCP server',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const paramsParsed = IdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) return reply.code(400).send({ error: 'Invalid ID' });
    const { id } = paramsParsed.data;
    const bodyParsed = McpServerUpdateSchema.safeParse(request.body);
    if (!bodyParsed.success) return reply.code(400).send({ error: bodyParsed.error.issues[0]?.message ?? 'Invalid input' });
    const body = bodyParsed.data;

    const existing = await getServerById(id);
    if (!existing) {
      return reply.code(404).send({ error: 'MCP server not found' });
    }

    const mcpDb = getDbForDomain('mcp');
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
    if (body.transport !== undefined) { updates.push('transport = ?'); values.push(body.transport); }
    if (body.command !== undefined) { updates.push('command = ?'); values.push(body.command); }
    if (body.url !== undefined) { updates.push('url = ?'); values.push(body.url); }
    if (body.args !== undefined) { updates.push('args = ?'); values.push(body.args); }
    if (body.env !== undefined) { updates.push('env = ?'); values.push(body.env); }
    if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }
    if (body.disabled_tools !== undefined) { updates.push('disabled_tools = ?'); values.push(body.disabled_tools); }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await mcpDb.execute(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`, values);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'mcp.server.update',
      target_type: 'mcp_server',
      target_id: existing.name,
      details: { fields: Object.keys(body) },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return await getServerById(id);
  });

  // Delete an MCP server config
  fastify.delete('/api/mcp/servers/:id', {
    schema: {
      tags: ['MCP'],
      summary: 'Delete an MCP server',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = IdParamSchema.safeParse(request.params).data ?? { id: NaN };

    const existing = await getServerById(id);
    if (!existing) {
      return reply.code(404).send({ error: 'MCP server not found' });
    }

    // Disconnect if connected
    if (isConnected(existing.name)) {
      await disconnectServer(existing.name);
    }

    const mcpDb = getDbForDomain('mcp');
    await mcpDb.execute('DELETE FROM mcp_servers WHERE id = ?', [id]);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'mcp.server.delete',
      target_type: 'mcp_server',
      target_id: existing.name,
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { success: true };
  });

  // Connect to an MCP server
  fastify.post('/api/mcp/servers/:id/connect', {
    schema: {
      tags: ['MCP'],
      summary: 'Connect to an MCP server',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = IdParamSchema.safeParse(request.params).data ?? { id: NaN };

    const server = await getServerById(id);
    if (!server) {
      return reply.code(404).send({ error: 'MCP server not found' });
    }

    try {
      await connectServer(server);
      return { success: true, name: server.name, connected: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      return reply.code(502).send({ error: message });
    }
  });

  // Disconnect from an MCP server
  fastify.post('/api/mcp/servers/:id/disconnect', {
    schema: {
      tags: ['MCP'],
      summary: 'Disconnect from an MCP server',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = IdParamSchema.safeParse(request.params).data ?? { id: NaN };

    const server = await getServerById(id);
    if (!server) {
      return reply.code(404).send({ error: 'MCP server not found' });
    }

    await disconnectServer(server.name);
    return { success: true, name: server.name, connected: false };
  });

  // List tools from a specific connected server
  fastify.get('/api/mcp/servers/:id/tools', {
    schema: {
      tags: ['MCP'],
      summary: 'List tools from a connected MCP server',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = IdParamSchema.safeParse(request.params).data ?? { id: NaN };

    const server = await getServerById(id);
    if (!server) {
      return reply.code(404).send({ error: 'MCP server not found' });
    }

    if (!isConnected(server.name)) {
      return reply.code(400).send({ error: 'Server is not connected' });
    }

    const tools = getServerTools(server.name);
    return { server: server.name, tools };
  });
}
