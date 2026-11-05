import { ProofMeshClient } from '@proofmesh/sdk';
import type { JSONRPCRequest, JSONRPCResponse, MCPServerOptions } from './types.js';
import { TOOLS } from './tools/index.js';

export class ProofMeshMCPServer {
  public readonly client: ProofMeshClient;
  public readonly serverName: string;
  public readonly serverVersion: string;

  constructor(options: MCPServerOptions) {
    this.serverName = options.serverName ?? 'proofmesh-mcp';
    this.serverVersion = options.serverVersion ?? '1.0.0';

    this.client = new ProofMeshClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      tenantId: options.tenantId,
      failOpen: false
    });
  }

  /**
   * Processes a JSON-RPC 2.0 request and returns a corresponding response.
   */
  public async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | null> {
    const id = request.id ?? null;

    if (request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
      };
    }

    try {
      switch (request.method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: this.serverName,
                version: this.serverVersion
              },
              capabilities: {
                tools: {}
              }
            }
          };
        }

        case 'notifications/initialized': {
          // MCP notification: no response required
          return null;
        }

        case 'ping': {
          return {
            jsonrpc: '2.0',
            id,
            result: {}
          };
        }

        case 'tools/list': {
          const tools = Object.values(TOOLS).map((t) => t.tool);
          return {
            jsonrpc: '2.0',
            id,
            result: { tools }
          };
        }

        case 'tools/call': {
          const params = request.params as { name: string; arguments?: Record<string, unknown> };
          if (!params || !params.name) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Invalid params: name is required' }
            };
          }

          const handler = TOOLS[params.name];
          if (!handler) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown tool: ${params.name}` }
            };
          }

          // Strict Authoritative State Protection Check (Core Rule 2)
          // LLMs are forbidden from mutating claim state directly to 'attested' or approving policies.
          if (
            params.name === 'register_claim' &&
            (params.arguments as Record<string, unknown> | undefined)?.status === 'attested'
          ) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: 'Forbidden: Authoritative attestation requires human verification and cannot be self-attested via MCP.'
                  }
                ],
                isError: true
              }
            };
          }

          const result = await handler.execute(params.arguments ?? {}, this.client);
          return {
            jsonrpc: '2.0',
            id,
            result
          };
        }

        default: {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${request.method}` }
          };
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error', data: message }
      };
    }
  }
}
