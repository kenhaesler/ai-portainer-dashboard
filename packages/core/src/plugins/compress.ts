import fp from 'fastify-plugin';
import compress from '@fastify/compress';
import zlib from 'zlib';
import type { FastifyInstance } from 'fastify';

async function compressPlugin(fastify: FastifyInstance) {
  await fastify.register(compress, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    brotliOptions: {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      },
    },
    zlibOptions: {
      level: 6,
    },
    threshold: 1024, // Only compress responses > 1KB
  });
}

export default fp(compressPlugin, { name: 'compress' });
