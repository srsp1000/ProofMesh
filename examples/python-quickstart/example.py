"""ProofMesh Python SDK Quickstart Example

Demonstrates:
1. Initializing ProofMeshClient
2. Scoping execution within a workflow context (contextvars)
3. Using @observe_workflow and @observe_tool decorators
4. Registering curated evidence context packets
5. Staging declared semantic claims
6. Declaring explicit evidence dependencies
7. Registering decisions and evaluating admissibility policies
8. Requesting human review for escalations
"""

import os
from proofmesh import (
    ProofMeshClient,
    observe_workflow,
    observe_tool,
    ContextPacketCreateInput,
    ContextPassageInput,
    SubmitClaimInput,
    DependencyDeclareInput,
    DependencyRelationship,
    DecisionRegisterInput,
    DecisionOutcome,
    AdmissibilityStatus,
    AdmissibilityCheckInput,
    HumanReviewRequestInput,
    HumanReviewPriority,
)

client = ProofMeshClient(
    api_key=os.getenv("PROOFMESH_API_KEY", "pm_live_example_key"),
    base_url=os.getenv("PROOFMESH_BASE_URL", "http://localhost:3000"),
    tenant_id=os.getenv("PROOFMESH_TENANT_ID", "12345678-1234-5678-1234-567812345678"),
)


@observe_tool(name="fetch_kyc_data", client=client)
def fetch_kyc_data(user_id: str) -> dict:
    return {
        "user_id": user_id,
        "passport_valid": True,
        "age": 30,
        "document_text": "Government Passport verified. Date of Birth: 1996-04-12."
    }


@observe_workflow(name="kyc_verification_pipeline", client=client)
def run_kyc_pipeline(user_id: str) -> None:
    print(f"🚀 Running KYC Verification for user {user_id}...")

    # Step 1: Execute observed tool
    kyc_data = fetch_kyc_data(user_id)

    # Step 2: Register curated context packet
    print("📦 Step 2: Creating context packet...")
    context_packet = client.create_context_packet(
        ContextPacketCreateInput(
            packetType="rag_retrieval",
            passages=[
                ContextPassageInput(
                    passageId="pass-123",
                    contentHash="a" * 64,
                    text=kyc_data["document_text"],
                    score=0.99
                )
            ],
            totalTokens=50
        )
    )
    print(f"✅ Context packet created: {context_packet.id}")

    # Step 3: Register factual claim
    print("📜 Step 3: Registering semantic claim...")
    claim = client.register_claim(
        SubmitClaimInput(
            claimConceptKey="user_age_verified",
            statement="User age exceeds regulatory requirement of 18 years.",
            contextPacketId=context_packet.id,
            qualifiers={"extracted_age": kyc_data["age"]}
        ),
        capture_method="declared"
    )
    print(f"✅ Claim registered: {claim.id} (Status: {claim.status})")

    # Step 4: Declare explicit dependency
    print("🔗 Step 4: Declaring evidence dependency...")
    dependency = client.declare_dependency(
        DependencyDeclareInput(
            dependentEntityId=claim.id,
            dependentEntityType="claim",
            prerequisiteEntityId=context_packet.id,
            prerequisiteEntityType="artifact",
            relationshipType=DependencyRelationship.SUPPORTS,
            declarationReason="Passport OCR verification directly corroborates age statement"
        )
    )
    print(f"✅ Dependency declared: {dependency.id}")

    # Step 5: Check admissibility
    print("⚖️ Step 5: Checking claim admissibility...")
    admissibility = client.check_admissibility(
        AdmissibilityCheckInput(
            claimVersionId=claim.id,
            policyName="default_kyc_policy"
        )
    )
    print(f"✅ Admissibility disposition: {admissibility.disposition} (isAdmissible: {admissibility.isAdmissible})")

    # Step 6: Register authoritative decision
    print("🏛️ Step 6: Registering decision...")
    decision = client.register_decision(
        DecisionRegisterInput(
            decisionType="account_approval",
            outcome=DecisionOutcome.ADMIT,
            rationale="User satisfies KYC and age requirements with verified passport",
            contributingClaimIds=[claim.id],
            admissibilityStatus=AdmissibilityStatus.ADMISSIBLE
        )
    )
    print(f"✅ Decision registered: {decision.id}")

    # Flush telemetry
    client.flush()
    print("✨ KYC Pipeline completed successfully.")


if __name__ == "__main__":
    try:
        run_kyc_pipeline("user-456")
    finally:
        client.close()
