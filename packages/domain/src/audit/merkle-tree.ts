import { createHash } from 'node:crypto';

export interface AuditEventChainItem {
  id: string | number;
  payloadHash: string;
  prevEventHash: string | null;
}

export class AuditIntegrityViolationError extends Error {
  constructor(
    message: string,
    public readonly eventId: string | number
  ) {
    super(`Audit Integrity Violation at Event ${eventId}: ${message}`);
    this.name = 'AuditIntegrityViolationError';
  }
}

export class MerkleTree {
  /**
   * Deterministically canonicalizes a JSON-compatible value and computes its SHA-256 hash.
   */
  static hashPayload(payload: unknown): string {
    const canonicalString = this.canonicalizeJson(payload);
    return `sha256:${createHash('sha256').update(canonicalString, 'utf8').digest('hex')}`;
  }

  /**
   * Hashes a pair of child nodes (left and right) for Merkle tree node calculation.
   */
  static hashPair(left: string, right: string): string {
    return `sha256:${createHash('sha256').update(`${left}:${right}`, 'utf8').digest('hex')}`;
  }

  /**
   * Computes the Merkle root of an ordered list of leaf hashes (audit event payload hashes).
   * If the list is empty, returns an empty root hash.
   */
  static computeRoot(leafHashes: readonly string[]): string {
    if (leafHashes.length === 0) {
      return `sha256:${createHash('sha256').update('EMPTY_MERKLE_TREE').digest('hex')}`;
    }

    let currentLevel = [...leafHashes];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i]!;
        // If odd number of elements, pair the last element with itself (standard Merkle tree practice)
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;
        nextLevel.push(this.hashPair(left, right));
      }
      currentLevel = nextLevel;
    }

    return currentLevel[0]!;
  }

  /**
   * Verifies the cryptographic chain integrity of a sequential list of audit events.
   * Checks that every event correctly references the preceding event's payload hash.
   */
  static verifyLinearChain(events: readonly AuditEventChainItem[]): void {
    if (events.length <= 1) return;

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const current = events[i]!;

      if (current.prevEventHash !== prev.payloadHash) {
        throw new AuditIntegrityViolationError(
          `Broken hash chain: expected prevEventHash to be '${prev.payloadHash}', but found '${current.prevEventHash}'`,
          current.id
        );
      }
    }
  }

  /**
   * Deterministic JSON canonicalization (keys sorted recursively) to guarantee stable hashing.
   */
  private static canonicalizeJson(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      return `[${obj.map((item) => this.canonicalizeJson(item)).join(',')}]`;
    }

    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const keyValPairs = sortedKeys.map((key) => {
      const val = (obj as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${this.canonicalizeJson(val)}`;
    });

    return `{${keyValPairs.join(',')}}`;
  }
}
