import type { ClaimStatus } from '@proofmesh/contracts';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly fromStatus: ClaimStatus,
    public readonly toStatus: ClaimStatus,
    public readonly reason: string
  ) {
    super(`Invalid claim state transition from '${fromStatus}' to '${toStatus}': ${reason}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export interface TransitionGuardContext {
  hasRefutingEvidence?: boolean;
  policyDisposition?: 'admit' | 'deny' | 'require_human_review' | 'warn' | 'remediate';
  hasHumanApproval?: boolean;
}

export class ClaimStateMachine {
  private static readonly VALID_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
    draft: ['submitted', 'archived'],
    submitted: ['evaluating'],
    evaluating: ['attested', 'disputed', 'rejected'],
    disputed: ['attested', 'rejected', 'evaluating'],
    attested: ['archived'],
    rejected: ['archived'],
    archived: []
  };

  public static canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
    const allowed = this.VALID_TRANSITIONS[from];
    return allowed.includes(to);
  }

  public static validateTransition(
    from: ClaimStatus,
    to: ClaimStatus,
    context: TransitionGuardContext = {}
  ): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(
        from,
        to,
        `Transition from '${from}' to '${to}' is not permitted by domain rules.`
      );
    }

    // Specific domain guard invariants
    if (from === 'evaluating' && to === 'attested') {
      if (context.hasRefutingEvidence) {
        throw new InvalidStateTransitionError(
          from,
          to,
          'Cannot attest a claim that contains active refuting evidence.'
        );
      }
      if (context.policyDisposition === 'deny') {
        throw new InvalidStateTransitionError(
          from,
          to,
          'Cannot attest a claim when policy disposition is DENY.'
        );
      }
    }

    if (from === 'disputed' && to === 'attested') {
      if (!context.hasHumanApproval) {
        throw new InvalidStateTransitionError(
          from,
          to,
          'Transition from disputed to attested requires authorized human approval.'
        );
      }
    }
  }
}
