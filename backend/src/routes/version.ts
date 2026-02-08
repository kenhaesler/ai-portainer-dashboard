import { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { VersionResponseSchema } from '../models/api-schemas.js';

const SHORT_HASH_LEN = 7;

function resolveGitDir(): string | null {
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, '.git');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function readGitDir(gitPath: string): string | null {
  try {
    const contents = readFileSync(gitPath, 'utf8').trim();
    if (contents.startsWith('gitdir:')) {
      const gitdir = contents.replace('gitdir:', '').trim();
      return path.isAbsolute(gitdir) ? gitdir : path.resolve(path.dirname(gitPath), gitdir);
    }
  } catch {
    // ignore
  }
  return null;
}

function readPackedRef(gitDir: string, ref: string): string | null {
  const packedPath = path.join(gitDir, 'packed-refs');
  if (!existsSync(packedPath)) return null;
  try {
    const contents = readFileSync(packedPath, 'utf8');
    const lines = contents.split('\n');
    for (const line of lines) {
      if (!line || line.startsWith('#') || line.startsWith('^')) continue;
      const [hash, refName] = line.split(' ');
      if (refName === ref) return hash;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveGitCommit(): string | null {
  const envCommit = process.env.GIT_COMMIT
    || process.env.VITE_GIT_COMMIT
    || process.env.APP_COMMIT;
  if (envCommit) return envCommit;

  const gitPath = resolveGitDir();
  if (!gitPath) return null;

  const gitDir = path.basename(gitPath) === '.git'
    ? gitPath
    : readGitDir(gitPath);
  if (!gitDir) return null;

  try {
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.replace('ref:', '').trim();
      const refPath = path.join(gitDir, ref);
      if (existsSync(refPath)) {
        return readFileSync(refPath, 'utf8').trim();
      }
      return readPackedRef(gitDir, ref);
    }
    return head;
  } catch {
    return null;
  }
}

export async function versionRoutes(fastify: FastifyInstance) {
  fastify.get('/api/version', {
    schema: {
      tags: ['System'],
      summary: 'Build version info',
      response: { 200: VersionResponseSchema },
    },
  }, async () => {
    const commit = resolveGitCommit();
    return {
      commit: commit ? commit.slice(0, SHORT_HASH_LEN) : 'dev',
    };
  });
}
