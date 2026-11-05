import dns from 'node:dns/promises';
import net from 'node:net';
import type { WebSourceIngestInput } from '@proofmesh/contracts';

export interface WebIngestionResult {
  originalUrl: string;
  resolvedUrl: string;
  statusCode: number;
  content: Buffer;
  mimeType: string;
  httpValidators: {
    etag?: string;
    lastModified?: string;
    cacheControl?: string;
  };
  retrievalTimestamp: string;
  publicationDate: string | null;
}

export class WebSourceIngestionService {
  /**
   * Canonicalizes a URL deterministically while preserving all meaningful query parameters.
   */
  public canonicalizeUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl);

    // 1. Lowercase scheme and host
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`Unsupported protocol '${protocol}': only http and https are permitted`);
    }

    // 2. Strip standard default ports
    let port = parsed.port;
    if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
      port = '';
    }

    // 3. Normalize path: remove duplicate slashes, handle dot segments
    let pathname = parsed.pathname;
    pathname = pathname.replace(/\/{2,}/g, '/');
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // 4. Sort query parameters deterministically without dropping parameters
    const searchParams = new URLSearchParams(parsed.search);
    const sortedEntries = Array.from(searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    const newSearchParams = new URLSearchParams();
    for (const [k, v] of sortedEntries) {
      newSearchParams.append(k, v);
    }
    const search = newSearchParams.toString() ? `?${newSearchParams.toString()}` : '';

    const hostAndPort = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${hostAndPort}${pathname}${search}`;
  }

  /**
   * Checks whether an IP address belongs to private, loopback, link-local, or cloud metadata ranges.
   */
  public isForbiddenIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 0) return true; // Invalid IP

    if (family === 4) {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4) return true;
      const [p0, p1] = parts;
      if (p0 === undefined || p1 === undefined) return true;

      // 0.0.0.0/8
      if (p0 === 0) return true;

      // 127.0.0.0/8 (Loopback)
      if (p0 === 127) return true;

      // 10.0.0.0/8 (Private)
      if (p0 === 10) return true;

      // 172.16.0.0/12 (Private)
      if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;

      // 192.168.0.0/16 (Private)
      if (p0 === 192 && p1 === 168) return true;

      // 169.254.0.0/16 (Link-local & Cloud Metadata: AWS/GCP/Azure 169.254.169.254)
      if (p0 === 169 && p1 === 254) return true;

      // 100.64.0.0/10 (Carrier NAT)
      if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;

      // 198.18.0.0/15 (Benchmarking)
      if (p0 === 198 && (p1 === 18 || p1 === 19)) return true;

      // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
      if (p0 >= 224) return true;

      return false;
    }

    if (family === 6) {
      const normalized = ip.toLowerCase();
      // ::1 (Loopback)
      if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
      // fe80::/10 (Link-local)
      if (
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb')
      )
        return true;
      // fc00::/7 & fd00::/8 (Unique Local Address)
      if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

      return false;
    }

    return true;
  }

  /**
   * Defends against SSRF, DNS rebinding, and unsafe redirects.
   */
  public async validateUrlSecurity(targetUrl: string): Promise<string> {
    const canonical = this.canonicalizeUrl(targetUrl);
    const parsed = new URL(canonical);
    const hostname = parsed.hostname;

    // Reject direct cloud metadata hostnames
    const blockedHostnames = ['metadata.google.internal', 'instance-data', 'metadata', 'localhost'];
    if (blockedHostnames.includes(hostname.toLowerCase())) {
      throw new Error(`SSRF Security Error: Access to forbidden host '${hostname}' is blocked`);
    }

    // If hostname is directly an IP address
    if (net.isIP(hostname)) {
      if (this.isForbiddenIp(hostname)) {
        throw new Error(
          `SSRF Security Error: Access to private/forbidden IP address '${hostname}' is blocked`
        );
      }
      return canonical;
    }

    // Resolve DNS and verify all returned IP addresses
    let addresses: string[] = [];
    try {
      const lookupResult = await dns.lookup(hostname, { all: true });
      addresses = lookupResult.map((a) => a.address);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`DNS resolution failed for host '${hostname}': ${msg}`);
    }

    if (addresses.length === 0) {
      throw new Error(`No DNS records found for host '${hostname}'`);
    }

    for (const addr of addresses) {
      if (this.isForbiddenIp(addr)) {
        throw new Error(
          `SSRF Security Error: Host '${hostname}' resolved to forbidden/private IP '${addr}' (DNS rebinding defense)`
        );
      }
    }

    return canonical;
  }

  /**
   * Safely fetches a web resource while preventing SSRF, following safe redirects,
   * and capturing HTTP validators.
   */
  public async ingestWebUrl(
    input: WebSourceIngestInput,
    customFetch?: typeof fetch
  ): Promise<WebIngestionResult> {
    const fetchImpl = customFetch ?? fetch;
    let currentUrl = await this.validateUrlSecurity(input.url);
    const originalUrl = currentUrl;
    const maxRedirects = input.maxRedirects ?? 3;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 10000);

      try {
        const response = await fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual', // Manual redirect control to validate each hop
          signal: controller.signal,
          headers: {
            'User-Agent': 'ProofMesh-SourceIngestion/1.0 (+https://proofmesh.io)'
          }
        });

        clearTimeout(timer);

        // Handle HTTP Redirects (301, 302, 307, 308)
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`Redirect response from '${currentUrl}' missing 'Location' header`);
          }

          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new Error(`Exceeded maximum allowed redirects (${maxRedirects})`);
          }

          const nextUrl = new URL(location, currentUrl).toString();
          // Validate new redirect target against SSRF rules!
          currentUrl = await this.validateUrlSecurity(nextUrl);
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch web source '${currentUrl}': HTTP status ${response.status}`
          );
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'text/html';
        const etag = response.headers.get('etag') || undefined;
        const lastModified = response.headers.get('last-modified') || undefined;
        const cacheControl = response.headers.get('cache-control') || undefined;

        // Strict Rule: Do NOT infer publication date from retrieval time!
        // Only set publicationDate if Last-Modified header is explicitly present and valid.
        let publicationDate: string | null = null;
        if (lastModified) {
          const parsedDate = new Date(lastModified);
          if (!isNaN(parsedDate.getTime())) {
            publicationDate = parsedDate.toISOString();
          }
        }

        return {
          originalUrl,
          resolvedUrl: currentUrl,
          statusCode: response.status,
          content: buffer,
          mimeType: (contentType.split(';')[0] ?? 'text/html').trim(),
          httpValidators: {
            etag,
            lastModified,
            cacheControl
          },
          retrievalTimestamp: new Date().toISOString(),
          publicationDate
        };
      } catch (err: unknown) {
        clearTimeout(timer);
        throw err;
      }
    }

    throw new Error(`Failed to ingest web URL '${input.url}'`);
  }
}
