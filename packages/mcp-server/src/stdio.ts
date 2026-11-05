import * as readline from 'node:readline';
import type { ProofMeshMCPServer } from './server.js';
import type { JSONRPCRequest } from './types.js';

export function runStdioTransport(server: ProofMeshMCPServer): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed) as JSONRPCRequest;
      const response = await server.handleRequest(request);
      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch {
      const parseError = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' }
      };
      process.stdout.write(JSON.stringify(parseError) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
