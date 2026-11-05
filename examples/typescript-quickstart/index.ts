/**
 * ProofMesh TypeScript SDK Quickstart Example
 * Demonstrates:
 * 1. Initializing ProofMeshClient
 * 2. Scoping execution within a workflow context (AsyncLocalStorage)
 * 3. Registering curated evidence context packets
 * 4. Staging declared semantic claims
 * 5. Declaring explicit evidence dependencies
 * 6. Registering decisions and evaluating admissibility policies
 * 7. Escalating edge cases to human review
 */

import { ProofMeshClient } from '@proofmesh/sdk';

async function main() {
  const client = new ProofMeshClient({
    apiKey: process.env.PROOFMESH_API_KEY || 'pm_live_example_key',
    baseUrl: process.env.PROOFMESH_BASE_URL || 'http://localhost:3000',
    tenantId: process.env.PROOFMESH_TENANT_ID || '12345678-1234-5678-1234-567812345678'
  });

  console.info('🚀 Running ProofMesh Governance Workflow...');

  // 1. Scoped workflow context
  await client.withWorkflow('kyc-verification-workflow-001', async () => {
    // 2. Curate RAG evidence passage packet
    console.info('📦 Step 1: Registering context packet...');
    const contextPacket = await client.contextPackets.create({
      packetType: 'rag_retrieval',
      passages: [
        {
          content: 'Government ID passport validated: Date of Birth indicates age is 28.',
          score: 0.99
        }
      ],
      totalTokens: 60
    });
    console.info(`✅ Context packet created: ${contextPacket.id}`);

    // 3. Register factual claim with declared provenance
    console.info('📜 Step 2: Registering factual claim...');
    const ageClaim = await client.claims.register({
      claimConceptKey: 'user_is_adult',
      statement: 'User is verified to be 18 years of age or older.',
      contextPacketId: contextPacket.id,
      qualifiers: {
        document_type: 'passport',
        extracted_age: 28
      },
      captureMethod: 'declared'
    });
    console.info(`✅ Claim registered: ${ageClaim.id} (Status: ${ageClaim.status})`);

    // 4. Declare explicit dependency between claim and prerequisite context
    console.info('🔗 Step 3: Declaring explicit evidence dependency...');
    const dependency = await client.dependencies.declare({
      dependentEntityId: ageClaim.id,
      dependentEntityType: 'claim',
      prerequisiteEntityId: contextPacket.id,
      prerequisiteEntityType: 'artifact',
      relationshipType: 'supports',
      declarationReason: 'Passport verification passage directly corroborates adult age assertion'
    });
    console.info(`✅ Dependency declared: ${dependency.id}`);

    // 5. Evaluate claim admissibility
    console.info('⚖️ Step 4: Checking policy admissibility...');
    const admissibility = await client.admissibility.check({
      claimVersionId: ageClaim.id,
      policyName: 'underwriting_evidence_sufficiency'
    });
    console.info(
      `✅ Admissibility disposition: ${admissibility.disposition} (isAdmissible: ${admissibility.isAdmissible})`
    );

    // 6. Register authoritative business decision
    console.info('🏛️ Step 5: Registering decision...');
    const decision = await client.decisions.register({
      decisionType: 'account_onboarding',
      outcome: 'approved',
      rationale: 'User passed identity and age verification with verified passport evidence',
      contributingClaimIds: [ageClaim.id],
      admissibilityStatus: 'admissible'
    });
    console.info(`✅ Decision registered: ${decision.id} (Outcome: ${decision.outcome})`);

    // 7. Flush telemetry spans
    console.info('📡 Step 6: Flushing telemetry...');
    await client.flush();
    console.info('✨ Workflow completed successfully.');
  });

  await client.close();
}

if (process.argv[1]?.endsWith('typescript-quickstart/index.ts')) {
  main().catch(console.error);
}
