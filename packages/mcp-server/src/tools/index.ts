import type { ProofMeshClient } from '@proofmesh/sdk';
import type { MCPTool, MCPCallToolResult } from '../types.js';

export interface ToolHandler {
  tool: MCPTool;
  execute: (args: Record<string, unknown>, client: ProofMeshClient) => Promise<MCPCallToolResult>;
}

export const TOOLS: Record<string, ToolHandler> = {
  lookup_claim: {
    tool: {
      name: 'lookup_claim',
      description:
        'Retrieve details, statements, and current status for an authoritative claim by its claim ID.',
      inputSchema: {
        type: 'object',
        properties: {
          claimId: {
            type: 'string',
            description: 'The unique UUID of the claim.'
          }
        },
        required: ['claimId']
      }
    },
    execute: async (args, client) => {
      const claimId = args.claimId as string | undefined;
      if (!claimId) {
        return {
          content: [{ type: 'text', text: 'Error: claimId is required' }],
          isError: true
        };
      }
      try {
        const claim = await client.claims.get(claimId);
        return {
          content: [{ type: 'text', text: JSON.stringify(claim, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to lookup claim: ${msg}` }],
          isError: true
        };
      }
    }
  },

  register_claim: {
    tool: {
      name: 'register_claim',
      description:
        "Stage or register a new semantic claim with ProofMesh. Sets captureMethod to 'declared' and initial status to 'submitted'. Direct transition to 'attested' is strictly prohibited for automated agents.",
      inputSchema: {
        type: 'object',
        properties: {
          conceptKey: {
            type: 'string',
            description: 'Key representing the claim concept (e.g., user_eligibility_checked).'
          },
          statement: {
            type: 'string',
            description: 'The natural language or formal factual claim statement.'
          },
          qualifiers: {
            type: 'object',
            description: 'Optional structured qualifiers or assertions supporting the claim.'
          },
          contextPacketId: {
            type: 'string',
            description: 'Optional ID of the curated context packet providing evidence.'
          }
        },
        required: ['conceptKey', 'statement']
      }
    },
    execute: async (args, client) => {
      try {
        const conceptKey = args.conceptKey as string;
        const statement = args.statement as string;
        const qualifiers = (args.qualifiers as Record<string, unknown> | undefined) ?? {};
        const contextPacketId = args.contextPacketId as string | undefined;

        const claim = await client.claims.register({
          claimConceptKey: conceptKey,
          statement,
          qualifiers,
          contextPacketId,
          captureMethod: 'declared'
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(claim, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to register claim: ${msg}` }],
          isError: true
        };
      }
    }
  },

  get_approved_context: {
    tool: {
      name: 'get_approved_context',
      description:
        'Retrieve a verified context packet and its curated evidence passages by packet ID.',
      inputSchema: {
        type: 'object',
        properties: {
          packetId: {
            type: 'string',
            description: 'UUID of the context packet.'
          }
        },
        required: ['packetId']
      }
    },
    execute: async (args, client) => {
      const packetId = args.packetId as string | undefined;
      if (!packetId) {
        return {
          content: [{ type: 'text', text: 'Error: packetId is required' }],
          isError: true
        };
      }
      try {
        const packet = await client.contextPackets.get(packetId);
        return {
          content: [{ type: 'text', text: JSON.stringify(packet, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to get context packet: ${msg}` }],
          isError: true
        };
      }
    }
  },

  declare_dependency: {
    tool: {
      name: 'declare_dependency',
      description:
        'Explicitly declare an evidence dependency between a dependent claim and a prerequisite claim. Provides strong declared lineage.',
      inputSchema: {
        type: 'object',
        properties: {
          dependentClaimId: {
            type: 'string',
            description: 'UUID of the claim that depends on prerequisite evidence.'
          },
          prerequisiteClaimId: {
            type: 'string',
            description: 'UUID of the prerequisite claim providing evidence or support.'
          },
          relationshipType: {
            type: 'string',
            enum: ['supports', 'refutes', 'qualifies', 'supersedes', 'derived_from'],
            description: 'The semantic relationship between the claims.'
          },
          declarationReason: {
            type: 'string',
            description: 'Explanation for why this dependency is declared.'
          }
        },
        required: ['dependentClaimId', 'prerequisiteClaimId', 'relationshipType']
      }
    },
    execute: async (args, client) => {
      try {
        const dependentClaimId = args.dependentClaimId as string;
        const prerequisiteClaimId = args.prerequisiteClaimId as string;
        const relationshipType = args.relationshipType as
          'supports' | 'refutes' | 'qualifies' | 'presupposes';
        const declarationReason = args.declarationReason as string | undefined;

        const dep = await client.dependencies.declare({
          dependentEntityId: dependentClaimId,
          dependentEntityType: 'claim',
          prerequisiteEntityId: prerequisiteClaimId,
          prerequisiteEntityType: 'claim',
          relationshipType: relationshipType ?? 'supports',
          declarationReason: declarationReason ?? 'Declared via Model Context Protocol'
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(dep, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to declare dependency: ${msg}` }],
          isError: true
        };
      }
    }
  },

  check_admissibility: {
    tool: {
      name: 'check_admissibility',
      description:
        'Check whether a claim satisfies admissibility criteria for use in production decisions. Read-only evaluation against governance policies; does not mutate claim status.',
      inputSchema: {
        type: 'object',
        properties: {
          claimVersionId: {
            type: 'string',
            description: 'UUID of the claim version to evaluate.'
          },
          policyName: {
            type: 'string',
            description: 'Optional governance policy name to evaluate against.'
          },
          contextParameters: {
            type: 'object',
            description: 'Optional contextual parameters for the policy evaluation.'
          }
        },
        required: ['claimVersionId']
      }
    },
    execute: async (args, client) => {
      try {
        const claimVersionId = args.claimVersionId as string;
        const policyName = args.policyName as string | undefined;
        const contextParameters =
          (args.contextParameters as Record<string, unknown> | undefined) ?? {};

        const result = await client.admissibility.check({
          claimVersionId,
          policyName,
          contextParameters
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to check admissibility: ${msg}` }],
          isError: true
        };
      }
    }
  },

  get_impact_report: {
    tool: {
      name: 'get_impact_report',
      description:
        'Evaluate downstream blast radius and affected decisions if a claim, artifact, or decision is revoked, refuted, or changed.',
      inputSchema: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: 'UUID of the root entity (claim, artifact, or decision).'
          },
          entityType: {
            type: 'string',
            enum: ['claim', 'artifact', 'decision'],
            description: 'Entity type (defaults to claim).'
          }
        },
        required: ['entityId']
      }
    },
    execute: async (args, client) => {
      try {
        const entityId = args.entityId as string;
        const entityType = (args.entityType as 'claim' | 'artifact' | 'decision') ?? 'claim';

        const report = await client.lineage.getImpactReport(entityId, entityType);
        return {
          content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to get impact report: ${msg}` }],
          isError: true
        };
      }
    }
  },

  request_review: {
    tool: {
      name: 'request_review',
      description:
        'Submit an escalation or review case requiring formal human operator sign-off. Models and agents cannot self-approve.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short title of the review request.'
          },
          summary: {
            type: 'string',
            description: 'Detailed explanation of why human review is required.'
          },
          requiredRole: {
            type: 'string',
            description: 'Required human reviewer role (e.g. compliance_officer, lead_architect).'
          },
          claimId: {
            type: 'string',
            description: 'Optional claim ID requiring human attestation.'
          },
          decisionId: {
            type: 'string',
            description: 'Optional decision ID under review.'
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Priority of review.'
          }
        },
        required: ['title', 'summary']
      }
    },
    execute: async (args, client) => {
      try {
        const title = args.title as string;
        const summary = args.summary as string;
        const requiredRole = (args.requiredRole as string | undefined) ?? 'compliance_officer';
        const claimId = args.claimId as string | undefined;
        const decisionId = args.decisionId as string | undefined;
        const priority = (args.priority as 'low' | 'medium' | 'high' | 'critical') ?? 'medium';

        const review = await client.reviews.request({
          title,
          summary,
          requiredRole,
          claimId,
          decisionId,
          priority
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(review, null, 2) }]
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Failed to request review: ${msg}` }],
          isError: true
        };
      }
    }
  }
};
