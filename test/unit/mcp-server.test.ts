import { describe, it, expect, vi } from 'vitest';
import { ProofMeshMCPServer } from '@proofmesh/mcp-server';
import type { MCPCallToolResult } from '@proofmesh/mcp-server';

describe('Model Context Protocol (MCP) Server Unit Tests', () => {
  const createServer = () => {
    return new ProofMeshMCPServer({
      apiKey: 'test_mcp_api_key',
      baseUrl: 'http://localhost:3000',
      tenantId: 'tenant-mcp-1'
    });
  };

  it('handles MCP initialize request', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    });

    expect(res).toBeDefined();
    expect(res?.id).toBe(1);
    const initResult = res?.result as {
      protocolVersion: string;
      serverInfo: { name: string };
      capabilities: { tools: unknown };
    };
    expect(initResult.protocolVersion).toBe('2024-11-05');
    expect(initResult.serverInfo.name).toBe('proofmesh-mcp');
    expect(initResult.capabilities.tools).toBeDefined();
  });

  it('handles MCP ping request', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping'
    });

    expect(res?.id).toBe(2);
    expect(res?.result).toEqual({});
  });

  it('lists all 7 governance and lineage tools via tools/list', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list'
    });

    expect(res?.id).toBe(3);
    const listResult = res?.result as { tools: Array<{ name: string }> };
    expect(Array.isArray(listResult.tools)).toBe(true);
    expect(listResult.tools).toHaveLength(7);

    const toolNames = listResult.tools.map((t) => t.name);
    expect(toolNames).toContain('lookup_claim');
    expect(toolNames).toContain('register_claim');
    expect(toolNames).toContain('get_approved_context');
    expect(toolNames).toContain('declare_dependency');
    expect(toolNames).toContain('check_admissibility');
    expect(toolNames).toContain('get_impact_report');
    expect(toolNames).toContain('request_review');
  });

  it('executes tools/call for lookup_claim', async () => {
    const server = createServer();
    vi.spyOn(server.client.claims, 'get').mockResolvedValue({
      id: 'claim-123',
      conceptId: 'concept-123',
      conceptKey: 'user_active',
      versionSequence: 1,
      statement: 'User account is active',
      status: 'submitted',
      qualifiers: {},
      validFrom: null,
      validTo: null,
      recordedAt: '2026-11-05T12:00:00Z'
    });

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'lookup_claim',
        arguments: { claimId: 'claim-123' }
      }
    });

    expect(res?.id).toBe(4);
    const result = res?.result as MCPCallToolResult;
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('user_active');
  });

  it('executes tools/call for register_claim with declared provenance', async () => {
    const server = createServer();
    vi.spyOn(server.client.claims, 'register').mockResolvedValue({
      id: 'claim-456',
      conceptId: 'concept-456',
      conceptKey: 'income_verified',
      versionSequence: 1,
      statement: 'Applicant annual income verified',
      status: 'submitted',
      qualifiers: { proofmesh_capture_method: 'declared' },
      validFrom: null,
      validTo: null,
      recordedAt: '2026-11-05T12:00:00Z'
    });

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'register_claim',
        arguments: {
          conceptKey: 'income_verified',
          statement: 'Applicant annual income verified'
        }
      }
    });

    expect(res?.id).toBe(5);
    const result = res?.result as MCPCallToolResult;
    expect(result.content[0].text).toContain('income_verified');
    expect(result.content[0].text).toContain('declared');
  });

  it('returns error code -32601 for unknown tool in tools/call', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'non_existent_tool',
        arguments: {}
      }
    });

    expect(res?.id).toBe(6);
    expect(res?.error?.code).toBe(-32601);
    expect(res?.error?.message).toContain('Unknown tool: non_existent_tool');
  });

  it('returns error code -32600 for invalid jsonrpc version', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '1.0' as unknown as '2.0',
      id: 7,
      method: 'ping'
    });

    expect(res?.error?.code).toBe(-32600);
  });
});
