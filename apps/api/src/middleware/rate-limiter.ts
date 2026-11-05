import type { FastifyRequest, FastifyReply } from 'fastify';
import { createProblemDetails } from '@proofmesh/contracts';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private clients = new Map<string, RateLimitEntry>();

  constructor(
    private readonly windowMs: number = 60_000, // 1 minute
    private readonly maxRequests: number = 20
  ) {}

  check(key: string): { allowed: boolean; remaining: number; resetAfterSeconds: number } {
    const now = Date.now();
    const entry = this.clients.get(key);

    if (!entry || now > entry.resetAt) {
      this.clients.set(key, { count: 1, resetAt: now + this.windowMs });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAfterSeconds: Math.ceil(this.windowMs / 1000)
      };
    }

    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAfterSeconds: Math.ceil((entry.resetAt - now) / 1000)
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAfterSeconds: Math.ceil((entry.resetAt - now) / 1000)
    };
  }

  createPreHandler() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const clientIp = request.ip || '127.0.0.1';
      const result = this.check(clientIp);

      reply.header('X-RateLimit-Limit', this.maxRequests);
      reply.header('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        reply.header('Retry-After', result.resetAfterSeconds);
        const problem = createProblemDetails({
          status: 429,
          code: 'RATE_LIMIT_EXCEEDED',
          title: 'Too Many Requests',
          detail: `Rate limit of ${this.maxRequests} requests per minute exceeded. Try again in ${result.resetAfterSeconds} seconds.`,
          instance: request.url
        });
        return reply.status(429).send(problem);
      }
    };
  }
}
