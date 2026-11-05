import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../apps/api/src/server.js';
import type { FastifyInstance } from 'fastify';

describe('Fastify API Integration Tests (Health & Claims)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns 200 with liveness status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('pass');
    expect(body.service).toBe('proofmesh-api');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /readyz returns 200 with readiness status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/readyz'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('pass');
  });

  it('POST /v1/claims returns 201 on valid submission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      payload: {
        claimConceptKey: 'compliance-check',
        statement: 'System conforms to ISO 27001 encryption standards.',
        qualifiers: { standard: 'ISO 27001' }
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('submitted');
    expect(body.statement).toContain('ISO 27001');
  });

  it('POST /v1/claims returns 400 with RFC 7807 Problem Details on invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claims',
      payload: {
        // missing claimConceptKey and statement
        qualifiers: {}
      }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.type).toBe('https://proofmesh.io/errors/validation-failed');
    expect(body.invalidParams).toBeDefined();
  });

  it('POST /v1/claims/:id/transition returns 409 when transition is illegal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/claims/d3b07384-d113-46fb-a0e2-df081fc7e8a9/transition',
      payload: {
        targetState: 'attested', // submitted -> attested directly is illegal
        transitionReason: 'Attempting illegal direct transition.'
      }
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.status).toBe(409);
    expect(body.code).toBe('INVALID_STATE_TRANSITION');
    expect(body.detail).toContain('not permitted by domain rules');
  });
});
