import crypto from 'node:crypto';
import type {
  CanonicalEventEnvelope,
  WebhookIngestPayload,
  WebhookHeaders
} from '@proofmesh/contracts';
import {
  WebhookIngestPayloadSchema,
  WebhookHeadersSchema,
  createCanonicalEnvelope
} from '@proofmesh/contracts';
import { WebhookSignatureVerifier } from '@proofmesh/domain';
import type { ProtocolAdapter, AdapterContext } from './adapter.interface.js';
import { ensureUuid } from './adapter.interface.js';
import { AdapterHealthService } from './adapter-health.service.js';

export interface WebhookAdapterConfig {
  adapterId: string;
  source: string;
  secret: string;
  maxSkewSeconds?: number;
}

export interface WebhookVerificationResult {
  success: boolean;
  code?: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'EXPIRED_TIMESTAMP' | 'INVALID_PAYLOAD';
  error?: string;
  envelopes?: CanonicalEventEnvelope[];
}

export class WebhookAdapter implements ProtocolAdapter<
  WebhookIngestPayload,
  Record<string, unknown>
> {
  readonly protocolName = 'webhook';
  private readonly healthService = AdapterHealthService.getInstance();

  constructor(private readonly config: WebhookAdapterConfig) {
    this.healthService.registerAdapter(config.adapterId, 'webhook', 'connected');
  }

  /**
   * Validates incoming HTTP headers and body, verifying HMAC-SHA256 signature and timestamp skew.
   */
  public verifyAndTransform(
    headers: WebhookHeaders,
    rawBody: string | Buffer,
    parsedPayload: unknown,
    context: AdapterContext
  ): WebhookVerificationResult {
    // 1. Validate headers schema
    const headerParse = WebhookHeadersSchema.safeParse(headers);
    if (!headerParse.success) {
      this.healthService.recordEventRejection(this.config.adapterId);
      return {
        success: false,
        code: 'MISSING_SIGNATURE',
        error: `Invalid webhook headers: ${headerParse.error.errors.map((e) => e.message).join(', ')}`
      };
    }

    // 2. Verify Cryptographic HMAC Signature & Timestamp Freshness
    const sigResult = WebhookSignatureVerifier.verify({
      secret: this.config.secret,
      signature: headerParse.data.signature,
      rawPayload: rawBody,
      timestampHeader: headerParse.data.timestamp,
      maxSkewSeconds: this.config.maxSkewSeconds ?? 300
    });

    if (!sigResult.valid) {
      this.healthService.recordEventRejection(this.config.adapterId);
      const isSkew = sigResult.reason?.includes('Timestamp skew');
      return {
        success: false,
        code: isSkew ? 'EXPIRED_TIMESTAMP' : 'INVALID_SIGNATURE',
        error: sigResult.reason ?? 'Webhook verification failed'
      };
    }

    // 3. Validate Payload Schema
    const payloadParse = WebhookIngestPayloadSchema.safeParse(parsedPayload);
    if (!payloadParse.success) {
      this.healthService.recordSchemaIncompatibility(this.config.adapterId);
      return {
        success: false,
        code: 'INVALID_PAYLOAD',
        error: `Webhook payload validation failed: ${payloadParse.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')}`
      };
    }

    this.healthService.recordEventReceived(this.config.adapterId);

    // 4. Transform into Canonical Event Envelope
    const envelopes = this.transform(payloadParse.data, context);
    return {
      success: true,
      envelopes
    };
  }

  /**
   * Implements ProtocolAdapter transform interface.
   */
  public transform(
    input: WebhookIngestPayload,
    context: AdapterContext
  ): CanonicalEventEnvelope<Record<string, unknown>>[] {
    const correlationId = input.correlationId ?? crypto.randomUUID();
    const idempotencyKey =
      input.idempotencyKey ??
      `wh_${this.config.source}_${crypto
        .createHash('sha256')
        .update(JSON.stringify(input.data))
        .digest('hex')}`;

    const actorPrincipalId = ensureUuid(
      context.actor?.principalId,
      `webhook_actor:${context.tenantId}:${this.config.source}`
    );

    const envelope = createCanonicalEnvelope({
      id: crypto.randomUUID(),
      source: `/tenants/${context.tenantId}/integrations/webhooks/${this.config.source}`,
      type: input.eventType,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      schemaVersion: '1.0.0',
      sourceIntegration: `webhook_${this.config.source}`,
      instanceIdentity: this.config.adapterId,
      actor: {
        principalId: actorPrincipalId,
        principalType: context.actor?.principalType ?? 'service_account'
      },
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      correlationId,
      causationId: input.causationId,
      idempotencyKey,
      captureMethod: 'declared',
      contentMode: 'metadata_only',
      data: input.data
    });

    return [envelope];
  }
}
