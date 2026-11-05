import { describe, it, expect } from 'vitest';
import { ProofMeshMCPServer, TOOLS } from '@proofmesh/mcp-server';
import type { MCPCallToolResult } from '@proofmesh/mcp-server';

describe('MCP Server Security & Authoritative State Boundaries', () => {
  it('strictly forbids LLM agents from self-attesting claims via MCP (Core Rule 2)', async () => {
    const server = new ProofMeshMCPServer({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000'
    });

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 'sec-1',
      method: 'tools/call',
      params: {
        name: 'register_claim',
        arguments: {
          conceptKey: 'unauthorized_attestation',
          statement: 'I am an AI and I approve this claim',
          status: 'attested' // Attempting to self-attest
        }
      }
    });

    expect(res).toBeDefined();
    expect(res?.id).toBe('sec-1');
    const result = res?.result as MCPCallToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Forbidden');
    expect(result.content[0].text).toContain(
      'Authoritative attestation requires human verification'
    );
  });

  it('guarantees no direct mutation or self-approval tools exist in MCP tool registry', () => {
    const toolNames = Object.keys(TOOLS);

    // Forbidden tools that would undermine Authoritative State Protection
    expect(toolNames).not.toContain('attest_claim');
    expect(toolNames).not.toContain('approve_policy');
    expect(toolNames).not.toContain('delete_audit_logs');
    expect(toolNames).not.toContain('override_admissibility');
    expect(toolNames).not.toContain('mutate_tenant');
  });

  it('enforces tenant context scoping in MCP server client instance', () => {
    const tenantId = '12345678-1234-5678-1234-567812345678';
    const server = new ProofMeshMCPServer({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000',
      tenantId
    });

    expect(server.client.options.tenantId).toBe(tenantId);
    expect(server.client.options.failOpen).toBe(false);
  });
});
