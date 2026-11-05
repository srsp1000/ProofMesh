import { z } from 'zod';

export const EdgeTypeEnum = z.enum([
  'derives_from',
  'supported_by',
  'refuted_by',
  'governed_by',
  'attested_by'
]);

export type EdgeType = z.infer<typeof EdgeTypeEnum>;

export const CaptureMethodEnum = z.enum([
  'captured',
  'declared',
  'attested',
  'inferred',
  'unknown'
]);

export type CaptureMethod = z.infer<typeof CaptureMethodEnum>;

export interface TypedDependencyEdgeInput {
  sourceNodeId: string;
  sourceNodeType: 'source_artifact' | 'evidence_item' | 'claim_version' | 'decision_version';
  targetNodeId: string;
  targetNodeType:
    'source_artifact' | 'evidence_item' | 'claim_version' | 'decision_version' | 'approval';
  edgeType: EdgeType;
  captureMethod: CaptureMethod;
  confidenceScore?: number;
}

export class DependencyVocabulary {
  public static isCausalProof(captureMethod: CaptureMethod): boolean {
    return captureMethod === 'captured' || captureMethod === 'attested';
  }

  public static validateEdge(input: TypedDependencyEdgeInput): void {
    EdgeTypeEnum.parse(input.edgeType);
    CaptureMethodEnum.parse(input.captureMethod);

    if (input.confidenceScore !== undefined) {
      if (input.confidenceScore < 0 || input.confidenceScore > 1) {
        throw new Error('Confidence score must be between 0.0 and 1.0');
      }
    }
  }
}
