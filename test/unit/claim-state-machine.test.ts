import { describe, it, expect } from 'vitest';
import {
  ClaimStateMachine,
  InvalidStateTransitionError
} from '../../packages/domain/src/claims/claim-state-machine.js';

describe('ClaimStateMachine (Unit)', () => {
  it('allows valid state progression: draft -> submitted -> evaluating -> attested -> archived', () => {
    expect(ClaimStateMachine.canTransition('draft', 'submitted')).toBe(true);
    expect(ClaimStateMachine.canTransition('submitted', 'evaluating')).toBe(true);
    expect(ClaimStateMachine.canTransition('evaluating', 'attested')).toBe(true);
    expect(ClaimStateMachine.canTransition('attested', 'archived')).toBe(true);

    expect(() => ClaimStateMachine.validateTransition('draft', 'submitted')).not.toThrow();
    expect(() => ClaimStateMachine.validateTransition('submitted', 'evaluating')).not.toThrow();
    expect(() => ClaimStateMachine.validateTransition('evaluating', 'attested')).not.toThrow();
    expect(() => ClaimStateMachine.validateTransition('attested', 'archived')).not.toThrow();
  });

  it('rejects illegal transitions: draft -> attested or rejected -> attested', () => {
    expect(ClaimStateMachine.canTransition('draft', 'attested')).toBe(false);
    expect(ClaimStateMachine.canTransition('rejected', 'attested')).toBe(false);

    expect(() => ClaimStateMachine.validateTransition('draft', 'attested')).toThrow(
      InvalidStateTransitionError
    );
    expect(() => ClaimStateMachine.validateTransition('rejected', 'attested')).toThrow(
      InvalidStateTransitionError
    );
  });

  it('blocks evaluating -> attested when active refuting evidence exists', () => {
    expect(() =>
      ClaimStateMachine.validateTransition('evaluating', 'attested', {
        hasRefutingEvidence: true
      })
    ).toThrow('Cannot attest a claim that contains active refuting evidence.');
  });

  it('blocks evaluating -> attested when policy disposition is DENY', () => {
    expect(() =>
      ClaimStateMachine.validateTransition('evaluating', 'attested', {
        policyDisposition: 'deny'
      })
    ).toThrow('Cannot attest a claim when policy disposition is DENY.');
  });

  it('blocks disputed -> attested without human approval', () => {
    expect(() =>
      ClaimStateMachine.validateTransition('disputed', 'attested', {
        hasHumanApproval: false
      })
    ).toThrow('Transition from disputed to attested requires authorized human approval.');

    expect(() =>
      ClaimStateMachine.validateTransition('disputed', 'attested', {
        hasHumanApproval: true
      })
    ).not.toThrow();
  });
});
