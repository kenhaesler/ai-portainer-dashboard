import { useState } from 'react';
import { Pencil, Plug, Plus, Power, PowerOff, Save, Trash2, Wrench } from 'lucide-react';
import {
  useMcpServers,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useConnectMcpServer,
  useDisconnectMcpServer,
  useMcpServerTools,
  type McpServer,
} from '@/features/ai-intelligence/hooks/use-mcp';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';
import { SkeletonList } from '@/shared/components/feedback/skeleton';

// ─── MCP Servers ────────────────────────────────────────────────────

export function McpServerRow({ server }: { server: McpServer }) {
  const connectMutation = useConnectMcpServer();
  const disconnectMutation = useDisconnectMcpServer();
  const deleteMutation = useDeleteMcpServer();
  const updateMutation = useUpdateMcpServer();
  const [showTools, setShowTools] = useState(false);
  const [showDeleteConfirmMcp, setShowDeleteConfirmMcp] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    transport: server.transport,
    command: server.command || '',
    url: server.url || '',
  });
  const toolsQuery = useMcpServerTools(server.id, showTools && server.connected);

  const handleSaveEdit = () => {
    const body: Record<string, string> = { transport: editData.transport };
    if (editData.transport === 'stdio') body.command = editData.command;
    else body.url = editData.url;
    updateMutation.mutate({ id: server.id, body }, {
      onSuccess: () => setIsEditing(false),
    });
  };

  const handleCancelEdit = () => {
    setEditData({
      transport: server.transport,
      command: server.command || '',
      url: server.url || '',
    });
    setIsEditing(false);
  };

  const isRequiredFieldEmpty = editData.transport === 'stdio'
    ? !editData.command.trim()
    : !editData.url.trim();

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            title={server.connected ? 'Connected' : 'Disconnected'}
            className={`h-2.5 w-2.5 rounded-full ${server.connected ? 'bg-emerald-500' : 'bg-gray-400'}`}
          />
          <span className="sr-only">{server.connected ? 'Connected' : 'Disconnected'}</span>
          <div>
            <div className="font-medium text-sm">{server.name}</div>
            <div className="text-xs text-muted-foreground">
              {server.transport} {server.transport === 'stdio' ? `· ${server.command}` : `· ${server.url}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {server.connected && (
            <button
              onClick={() => setShowTools(!showTools)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Show tools"
            >
              <Wrench className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => {
              setEditData({
                transport: server.transport,
                command: server.command || '',
                url: server.url || '',
              });
              setIsEditing(!isEditing);
            }}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {server.connected ? (
            <button
              onClick={() => disconnectMutation.mutate(server.id)}
              disabled={disconnectMutation.isPending}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Disconnect"
            >
              <PowerOff className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => connectMutation.mutate(server.id)}
              disabled={connectMutation.isPending}
              className="p-1.5 rounded-md hover:bg-accent text-emerald-500 hover:text-emerald-400 transition-colors"
              title="Connect"
            >
              <Power className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirmMcp(true)}
            disabled={deleteMutation.isPending}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {isEditing && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Transport</label>
            <select
              value={editData.transport}
              onChange={e => setEditData(p => ({ ...p, transport: e.target.value as 'stdio' | 'sse' | 'http' }))}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              <option value="stdio">stdio (local command)</option>
              <option value="sse">SSE (remote)</option>
              <option value="http">HTTP (streamable)</option>
            </select>
          </div>
          {editData.transport === 'stdio' ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Command</label>
              <input
                value={editData.command}
                onChange={e => setEditData(p => ({ ...p, command: e.target.value }))}
                placeholder="npx -y @modelcontextprotocol/server-filesystem /data"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">URL</label>
              <input
                value={editData.url}
                onChange={e => setEditData(p => ({ ...p, url: e.target.value }))}
                placeholder="http://kali-mcp:8000/mcp"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancelEdit}
              className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={isRequiredFieldEmpty || updateMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
          {updateMutation.isError && (
            <p className="text-xs text-red-400">{updateMutation.error.message}</p>
          )}
        </div>
      )}
      {server.connectionError && (
        <p className="text-xs text-red-400">{server.connectionError}</p>
      )}
      {server.connected && (
        <span className="text-xs text-muted-foreground">{server.toolCount} tools available</span>
      )}
      {showTools && toolsQuery.data && (
        <div className="border-t border-border pt-2 space-y-1">
          {toolsQuery.data.tools.map(tool => (
            <div key={tool.name} className="text-xs py-1 px-2 rounded bg-muted/50">
              <span className="font-mono font-medium">{tool.name}</span>
              {tool.description && <span className="text-muted-foreground ml-2">— {tool.description}</span>}
            </div>
          ))}
          {toolsQuery.data.tools.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No tools exposed by this server</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={showDeleteConfirmMcp}
        onConfirm={() => { deleteMutation.mutate(server.id); setShowDeleteConfirmMcp(false); }}
        onCancel={() => setShowDeleteConfirmMcp(false)}
        title="Delete MCP Server"
        description={`Delete MCP server "${server.name}"?`}
        confirmLabel="Delete"
      />
    </div>
  );
}

// Exported for tests (loading skeleton, #1549).
export function McpServersSection() {
  const { data: servers, isLoading } = useMcpServers();
  const createMutation = useCreateMcpServer();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'sse' | 'http',
    command: '',
    url: '',
  });

  const handleAdd = () => {
    const body: Record<string, string> = { name: formData.name, transport: formData.transport };
    if (formData.transport === 'stdio') body.command = formData.command;
    else body.url = formData.url;
    createMutation.mutate(body as any, {
      onSuccess: () => {
        setFormData({ name: '', transport: 'stdio', command: '', url: '' });
        setShowForm(false);
      },
    });
  };

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Plug className="h-5 w-5 text-purple-500" />
          <div>
            <h3 className="font-semibold text-base">MCP Servers</h3>
            <p className="text-xs text-muted-foreground">Connect external tool servers for the AI assistant</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add Server
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
              <input
                value={formData.name}
                onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="kali-mcp"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Transport</label>
              <select
                value={formData.transport}
                onChange={e => setFormData(p => ({ ...p, transport: e.target.value as any }))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              >
                <option value="stdio">stdio (local command)</option>
                <option value="sse">SSE (remote)</option>
                <option value="http">HTTP (streamable)</option>
              </select>
            </div>
          </div>
          {formData.transport === 'stdio' ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Command</label>
              <input
                value={formData.command}
                onChange={e => setFormData(p => ({ ...p, command: e.target.value }))}
                placeholder="npx -y @modelcontextprotocol/server-filesystem /data"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">URL</label>
              <input
                value={formData.url}
                onChange={e => setFormData(p => ({ ...p, url: e.target.value }))}
                placeholder="http://kali-mcp:8000/mcp"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!formData.name || createMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Server'}
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-400">{createMutation.error.message}</p>
          )}
        </div>
      )}

      {isLoading && <SkeletonList rows={3} />}
      {servers && servers.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground text-center py-4">No MCP servers configured yet</p>
      )}
      {servers?.map(server => (
        <McpServerRow key={server.id} server={server} />
      ))}
    </div>
  );
}
