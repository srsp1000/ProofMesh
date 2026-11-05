import { describe, it, expect } from 'vitest';
import { WebSourceIngestionService } from '../../packages/domain/src/sources/web-ingestion.js';

describe('WebSourceIngestionService SSRF Defense (Security)', () => {
  const service = new WebSourceIngestionService();

  describe('URL Canonicalization', () => {
    it('sorts query parameters deterministically without dropping any params', () => {
      const urlA = 'https://example.com/api/v1?zebra=1&apple=2&banana=3';
      const canonicalA = service.canonicalizeUrl(urlA);
      expect(canonicalA).toBe('https://example.com/api/v1?apple=2&banana=3&zebra=1');

      const urlB = 'https://example.com/api/v1?banana=3&zebra=1&apple=2';
      const canonicalB = service.canonicalizeUrl(urlB);
      expect(canonicalB).toBe(canonicalA);
    });

    it('strips default HTTP and HTTPS ports', () => {
      expect(service.canonicalizeUrl('http://example.com:80/path')).toBe('http://example.com/path');
      expect(service.canonicalizeUrl('https://example.com:443/path')).toBe(
        'https://example.com/path'
      );
      expect(service.canonicalizeUrl('https://example.com:8443/path')).toBe(
        'https://example.com:8443/path'
      );
    });

    it('rejects unsupported protocols like file://, gopher://, ftp://', () => {
      expect(() => service.canonicalizeUrl('file:///etc/passwd')).toThrow(/Unsupported protocol/);
      expect(() => service.canonicalizeUrl('gopher://evil.com/1')).toThrow(/Unsupported protocol/);
      expect(() => service.canonicalizeUrl('ftp://example.com/file')).toThrow(
        /Unsupported protocol/
      );
    });
  });

  describe('SSRF IP & Host Denylist Defense', () => {
    it('blocks loopback IPv4 addresses (127.0.0.0/8)', () => {
      expect(service.isForbiddenIp('127.0.0.1')).toBe(true);
      expect(service.isForbiddenIp('127.0.0.254')).toBe(true);
      expect(service.isForbiddenIp('127.255.255.255')).toBe(true);
    });

    it('blocks RFC 1918 private IPv4 addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
      expect(service.isForbiddenIp('10.0.0.1')).toBe(true);
      expect(service.isForbiddenIp('10.254.0.1')).toBe(true);
      expect(service.isForbiddenIp('172.16.0.1')).toBe(true);
      expect(service.isForbiddenIp('172.31.255.254')).toBe(true);
      expect(service.isForbiddenIp('192.168.1.1')).toBe(true);
      expect(service.isForbiddenIp('192.168.0.254')).toBe(true);
    });

    it('blocks cloud metadata IP 169.254.169.254 (AWS, GCP, Azure, Oracle)', () => {
      expect(service.isForbiddenIp('169.254.169.254')).toBe(true);
      expect(service.isForbiddenIp('169.254.0.1')).toBe(true);
    });

    it('blocks IPv6 loopback, link-local, and unique local addresses', () => {
      expect(service.isForbiddenIp('::1')).toBe(true);
      expect(service.isForbiddenIp('fe80::1')).toBe(true);
      expect(service.isForbiddenIp('fc00::1')).toBe(true);
      expect(service.isForbiddenIp('fd00::1')).toBe(true);
    });

    it('allows valid public IP addresses', () => {
      expect(service.isForbiddenIp('8.8.8.8')).toBe(false);
      expect(service.isForbiddenIp('93.184.216.34')).toBe(false);
      expect(service.isForbiddenIp('1.1.1.1')).toBe(false);
    });
  });

  describe('Safe Ingestion & Publication Date Non-Inference', () => {
    it('strictly preserves Last-Modified as publication date if available, otherwise null (never retrieval timestamp)', async () => {
      const mockHtml = '<html><body><h1>ProofMesh Doc</h1></body></html>';
      const mockFetch: typeof fetch = async (_input, _init) => {
        return new Response(mockHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'last-modified': 'Wed, 21 Oct 2025 07:28:00 GMT',
            etag: '"33a64df551425fcc3e42928da0d4f2b"'
          }
        });
      };

      const result = await service.ingestWebUrl(
        {
          url: 'https://example.com/doc',
          permissionContext: 'public',
          maxRedirects: 3,
          timeoutMs: 5000
        },
        mockFetch
      );

      expect(result.publicationDate).toBe('2025-10-21T07:28:00.000Z');
      expect(result.httpValidators.etag).toBe('"33a64df551425fcc3e42928da0d4f2b"');
      expect(result.retrievalTimestamp).not.toBe(result.publicationDate);
    });

    it('sets publicationDate to null when Last-Modified header is absent', async () => {
      const mockHtml = '<html><body><h1>No Date Doc</h1></body></html>';
      const mockFetch: typeof fetch = async () => {
        return new Response(mockHtml, {
          status: 200,
          headers: {
            'content-type': 'text/html'
          }
        });
      };

      const result = await service.ingestWebUrl(
        {
          url: 'https://example.com/nodate',
          permissionContext: 'public',
          maxRedirects: 3,
          timeoutMs: 5000
        },
        mockFetch
      );

      // Must be null — NOT current retrieval time
      expect(result.publicationDate).toBeNull();
      expect(result.retrievalTimestamp).toBeDefined();
    });

    it('aborts when redirect count exceeds maximum limit', async () => {
      const mockRedirectFetch: typeof fetch = async () => {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'https://example.com/next-redirect'
          }
        });
      };

      await expect(
        service.ingestWebUrl(
          {
            url: 'https://example.com/loop',
            permissionContext: 'public',
            maxRedirects: 2,
            timeoutMs: 5000
          },
          mockRedirectFetch
        )
      ).rejects.toThrow(/Exceeded maximum allowed redirects \(2\)/);
    });
  });
});
