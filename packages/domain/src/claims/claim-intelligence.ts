import crypto from 'node:crypto';
import type {
  ClaimExtractionInput,
  ClaimExtractionResult,
  MaterialProposition,
  PropositionType,
  ConfidenceCategory,
  DuplicateConceptCandidate
} from '@proofmesh/contracts';

export class ClaimIntelligenceService {
  /**
   * Extracts atomic material propositions from source text and normalizes them.
   */
  public extractPropositions(input: ClaimExtractionInput): ClaimExtractionResult {
    const rawText = input.text.trim();
    if (!rawText) {
      throw new Error('Cannot extract propositions from empty text');
    }

    // Split compound sentences and clauses
    const clauses = this.decomposeCompoundStatements(rawText);
    const propositions: MaterialProposition[] = [];
    const rejectedSegments: Array<{ text: string; reason: string }> = [];

    let extractedCharacters = 0;

    for (const clause of clauses) {
      const trimmed = clause.trim();
      if (trimmed.length < 5) {
        rejectedSegments.push({ text: trimmed, reason: 'insufficient_text_length' });
        continue;
      }

      // Check for boilerplate or disclaimer
      if (this.isBoilerplateOrDisclaimer(trimmed)) {
        rejectedSegments.push({ text: trimmed, reason: 'disclaimer_or_boilerplate' });
        continue;
      }

      const prop = this.normalizeProposition(trimmed, input.sourcePassageId);
      if (prop) {
        propositions.push(prop);
        extractedCharacters += trimmed.length;
      } else {
        rejectedSegments.push({ text: trimmed, reason: 'unparseable_structure' });
      }
    }

    const coverageScore = Math.min(
      1.0,
      Math.round((extractedCharacters / rawText.length) * 100) / 100
    );

    return {
      extractionId: crypto.randomUUID(),
      sourceVersionId: input.sourceVersionId,
      propositions,
      coverageScore,
      rejectedSegments,
      modelMetadata: input.modelMetadata,
      promptTemplateVersion: input.promptTemplateVersion,
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Decomposes compound sentences and multi-clause statements into atomic clauses.
   */
  public decomposeCompoundStatements(text: string): string[] {
    // Split on sentence boundaries (. ! ?) and compound conjunctions (; and, while also)
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const atomicClauses: string[] = [];

    for (const sentence of sentences) {
      // Split on semicolons
      const semiSplit = sentence.split(/\s*;\s*/);
      for (const part of semiSplit) {
        // Split on compound conjunctions: " and also ", " and ", ", while "
        const conjSplit = part.split(
          /\s+and\s+(?=[A-Z0-9a-z]+\s+(?:is|are|was|were|has|have|had|costs|supports|guarantees|exceeds|provides|operates|maintains|requires))/i
        );
        for (const sub of conjSplit) {
          const cleaned = sub.replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
          if (cleaned) {
            atomicClauses.push(cleaned);
          }
        }
      }
    }

    return atomicClauses;
  }

  /**
   * Classifies and normalizes a single clause into a structured proposition.
   */
  public normalizeProposition(
    clause: string,
    sourcePassageId?: string
  ): MaterialProposition | null {
    const propositionType = this.classifyPropositionType(clause);
    const parsed = this.parseSubjectPredicateObject(clause);
    const qualifiers = this.extractQualifiers(clause);
    const unit = this.extractUnit(clause);

    // Confidence estimation (model estimate, NOT calibrated truth probability)
    const confidenceScore = propositionType === 'factual_claim' ? 0.95 : 0.85;
    const confidenceCategory: ConfidenceCategory =
      confidenceScore >= 0.9 ? 'high' : confidenceScore >= 0.7 ? 'medium' : 'low';

    return {
      id: crypto.randomUUID(),
      propositionType,
      rawStatement: clause,
      normalizedSubject: parsed.subject,
      normalizedPredicate: parsed.predicate,
      normalizedObject: parsed.object,
      normalizedUnit: unit,
      qualifiers,
      sourcePassageId: sourcePassageId ?? null,
      confidenceScore,
      confidenceCategory
    };
  }

  /**
   * Classifies a statement into factual_claim, opinion, forecast, commitment, or instruction.
   */
  public classifyPropositionType(text: string): PropositionType {
    const lower = text.toLowerCase();

    // 1. Commitments (formal promises, guarantees, SLAs)
    if (
      /\b(?:we\s+guarantee|guarantees?|we\s+commit|commits?|sla\b|promise|will\s+refund|warrants?\b|pledges?)\b/.test(
        lower
      )
    ) {
      return 'commitment';
    }

    // 2. Instructions / Directives
    if (
      /\b(?:must\b|shall\b|please\s+ensure|required\s+to|mandatory|do\s+not\b|never\s+share)\b/.test(
        lower
      )
    ) {
      return 'instruction';
    }

    // 3. Forecasts (future projections, expectations)
    if (
      /\b(?:is\s+expected\s+to|projected\s+to|forecasted|anticipate|target\s+for\s+20\d\d|by\s+20\d\d)\b/.test(
        lower
      )
    ) {
      return 'forecast';
    }

    // 4. Opinions (subjective assessments, superlatives)
    if (
      /\b(?:we\s+believe|in\s+our\s+view|best\b|superior|intuitive|world-class|delightful|seamless|revolutionary)\b/.test(
        lower
      )
    ) {
      return 'opinion';
    }

    // 5. Default to factual claim
    return 'factual_claim';
  }

  /**
   * Extracts Subject, Predicate, and Object from text.
   */
  public parseSubjectPredicateObject(clause: string): {
    subject: string;
    predicate: string;
    object: string;
  } {
    // Match common verbal patterns: "Subject [predicate] Object"
    const verbPattern =
      /\b(is|are|was|were|has|have|had|costs?|supports?|guarantees?|exceeds?|provides?|operates?|maintains?|requires?|was\s+founded\s+in|raised|achieved|generated)\b/i;
    const match = clause.match(verbPattern);

    if (match && match.index !== undefined) {
      const subject = clause.slice(0, match.index).trim() || 'entity';
      const predicate = match[0].trim().toLowerCase();
      const object = clause.slice(match.index + match[0].length).trim() || clause;
      return {
        subject: subject.replace(/^the\s+/i, '').trim(),
        predicate,
        object: object.replace(/[.]+$/, '').trim()
      };
    }

    // Fallback: simple token splitting
    const words = clause.split(/\s+/);
    if (words.length >= 3) {
      return {
        subject: words[0] ?? 'entity',
        predicate: 'asserts',
        object: words.slice(1).join(' ').replace(/[.]+$/, '').trim()
      };
    }

    return {
      subject: 'entity',
      predicate: 'states',
      object: clause.replace(/[.]+$/, '').trim()
    };
  }

  /**
   * Extracts structured qualifiers: product, version, region, plan, temporal.
   * Preserves null for absent fields — never invents values.
   */
  public extractQualifiers(text: string): {
    product: string | null;
    version: string | null;
    region: string | null;
    plan: string | null;
    temporal: string | null;
  } {
    const lower = text.toLowerCase();

    // 1. Region
    let region: string | null = null;
    if (/\b(?:us|united\s+states|north\s+america)\b/i.test(lower)) region = 'US';
    else if (/\b(?:eu|europe|european\s+union)\b/i.test(lower)) region = 'EU';
    else if (/\b(?:apac|asia|asia-pacific)\b/i.test(lower)) region = 'APAC';
    else if (/\b(?:uk|united\s+kingdom)\b/i.test(lower)) region = 'UK';
    else if (/\b(?:global|worldwide)\b/i.test(lower)) region = 'GLOBAL';

    // 2. Plan / Tier
    let plan: string | null = null;
    if (/\b(?:enterprise|premium|pro|standard|free\s+tier|basic)\b/i.test(lower)) {
      const match = lower.match(/\b(enterprise|premium|pro|standard|free\s+tier|basic)\b/);
      plan = match ? match[0] : null;
    }

    // 3. Product / Service name
    let product: string | null = null;
    const prodMatch = text.match(
      /\b(?:ProofMesh|Switch|Platform|Database|API|Service\s+[A-Z0-9]+)\b/i
    );
    if (prodMatch) {
      product = prodMatch[0];
    }

    // 4. Version
    let version: string | null = null;
    const verMatch = text.match(/\bv?(\d+\.\d+(?:\.\d+)?)\b/);
    if (verMatch) {
      version = verMatch[1] ?? null;
    }

    // 5. Temporal
    let temporal: string | null = null;
    const yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
    const quarterMatch = text.match(/\b(Q[1-4]\s*(?:20\d\d)?)\b/i);
    if (quarterMatch) {
      temporal = quarterMatch[0];
    } else if (yearMatch) {
      temporal = yearMatch[0];
    }

    return {
      product,
      version,
      region,
      plan,
      temporal
    };
  }

  /**
   * Extracts quantitative units (currency, %, ms, users, years).
   */
  public extractUnit(text: string): string | null {
    if (/\$|usd\b/i.test(text)) return 'USD';
    if (/€|eur\b/i.test(text)) return 'EUR';
    if (/£|gbp\b/i.test(text)) return 'GBP';
    if (/%|percent\b/i.test(text)) return 'percent';
    if (/\bms\b|milliseconds\b/i.test(text)) return 'ms';
    if (/\bseconds?\b/i.test(text)) return 'seconds';
    if (/\busers?\b/i.test(text)) return 'users';
    if (/\byears?\b/i.test(text)) return 'years';
    return null;
  }

  /**
   * Detects duplicate concept candidates based on subject + predicate + object,
   * but strictly flags differing scopes (region, plan, temporal) so they are NOT merged.
   */
  public detectDuplicateConcept(
    newProposition: MaterialProposition,
    existingConcepts: Array<{
      id: string;
      conceptKey: string;
      qualifiers?: Record<string, unknown>;
    }>
  ): DuplicateConceptCandidate[] {
    const candidates: DuplicateConceptCandidate[] = [];
    const newCore =
      `${newProposition.normalizedSubject}_${newProposition.normalizedPredicate}_${newProposition.normalizedObject}`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');

    for (const concept of existingConcepts) {
      const existingKey = concept.conceptKey.toLowerCase().replace(/[^a-z0-9_]/g, '');

      // Check key similarity
      if (existingKey.includes(newProposition.normalizedSubject.toLowerCase())) {
        const scopeDifferences: string[] = [];

        const existingQuals = (concept.qualifiers as Record<string, unknown>) || {};
        const newQuals = newProposition.qualifiers as Record<string, unknown>;

        if (newQuals.region && existingQuals.region && newQuals.region !== existingQuals.region) {
          scopeDifferences.push(`region:${newQuals.region}!=${existingQuals.region}`);
        }
        if (newQuals.plan && existingQuals.plan && newQuals.plan !== existingQuals.plan) {
          scopeDifferences.push(`plan:${newQuals.plan}!=${existingQuals.plan}`);
        }
        if (
          newQuals.temporal &&
          existingQuals.temporal &&
          newQuals.temporal !== existingQuals.temporal
        ) {
          scopeDifferences.push(`temporal:${newQuals.temporal}!=${existingQuals.temporal}`);
        }
        if (
          newQuals.product &&
          existingQuals.product &&
          newQuals.product !== existingQuals.product
        ) {
          scopeDifferences.push(`product:${newQuals.product}!=${existingQuals.product}`);
        }

        // If scopes differ, canMerge MUST be false
        const canMerge = scopeDifferences.length === 0 && existingKey === newCore;
        const similarityScore = existingKey === newCore ? 1.0 : 0.75;

        candidates.push({
          conceptId: concept.id,
          conceptKey: concept.conceptKey,
          similarityScore,
          scopeDifferences,
          canMerge
        });
      }
    }

    return candidates;
  }

  private isBoilerplateOrDisclaimer(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.startsWith('all rights reserved') ||
      lower.startsWith('copyright') ||
      lower.includes('confidential and proprietary') ||
      lower.includes('terms of service apply')
    );
  }
}
