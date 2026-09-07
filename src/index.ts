#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSsoMcpServer } from './server.js';

try {
  await serveStdio(() => createSsoMcpServer(), { legacy: 'serve' });
} catch (error) {
  console.error('ssomcp server failed:', error);
  process.exitCode = 1;
}
