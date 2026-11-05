import { ProofMeshMCPServer } from './server.js';
import { runStdioTransport } from './stdio.js';

export { ProofMeshMCPServer } from './server.js';
export { runStdioTransport } from './stdio.js';
export { TOOLS } from './tools/index.js';
export * from './types.js';

// If run directly from CLI / bin
if (process.argv[1]?.endsWith('dist/index.js') || process.argv[1]?.endsWith('proofmesh-mcp')) {
  const apiKey = process.env.PROOFMESH_API_KEY || 'pm_live_development_key';
  const baseUrl = process.env.PROOFMESH_BASE_URL || 'http://localhost:3000';
  const tenantId = process.env.PROOFMESH_TENANT_ID;

  const server = new ProofMeshMCPServer({
    apiKey,
    baseUrl,
    tenantId
  });

  runStdioTransport(server);
}
