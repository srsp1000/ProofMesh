from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# 1. Claim Enums and Models
class ClaimStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    EVALUATING = "evaluating"
    ATTESTED = "attested"
    DISPUTED = "disputed"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class SubmitClaimInput(BaseModel):
    claimConceptKey: str = Field(..., min_length=1, max_length=100)
    statement: str = Field(..., min_length=1, max_length=10000)
    qualifiers: Dict[str, Any] = Field(default_factory=dict)
    contextPacketId: Optional[str] = None
    idempotencyKey: Optional[str] = None


class ClaimVersionDTO(BaseModel):
    id: str
    conceptId: str
    conceptKey: str
    versionSequence: int
    statement: str
    status: ClaimStatus
    qualifiers: Dict[str, Any] = Field(default_factory=dict)
    validFrom: Optional[str] = None
    validTo: Optional[str] = None
    recordedAt: str


class TransitionClaimInput(BaseModel):
    targetState: ClaimStatus
    transitionReason: str = Field(..., min_length=1, max_length=1000)
    evidenceAssessmentIds: List[str] = Field(default_factory=list)


# 2. Context Packet Models
class ContextPassageInput(BaseModel):
    passageId: str
    contentHash: str
    text: Optional[str] = None
    score: Optional[float] = None


class ContextPacketCreateInput(BaseModel):
    packetType: str = Field(default="evidence_retrieval", min_length=1, max_length=100)
    passages: List[ContextPassageInput] = Field(..., min_length=1)
    totalTokens: int = Field(default=0, ge=0)
    idempotencyKey: Optional[str] = None


class ContextPacketDTO(BaseModel):
    id: str
    tenantId: str
    packetType: str
    passages: List[Dict[str, Any]]
    totalTokens: int
    createdAt: str


# 3. Dependency Models
class DependencyRelationship(str, Enum):
    SUPPORTS = "supports"
    REFUTES = "refutes"
    QUALIFIES = "qualifies"
    SUPERSEDES = "supersedes"
    DERIVED_FROM = "derived_from"


class DependencyDeclareInput(BaseModel):
    dependentEntityId: str
    dependentEntityType: str = Field(default="claim")
    prerequisiteEntityId: str
    prerequisiteEntityType: str = Field(default="claim")
    relationshipType: DependencyRelationship
    declarationReason: str = Field(..., min_length=1, max_length=1000)
    idempotencyKey: Optional[str] = None


class DependencyDTO(BaseModel):
    id: str
    tenantId: str
    dependentEntityId: str
    dependentEntityType: str
    prerequisiteEntityId: str
    prerequisiteEntityType: str
    relationshipType: DependencyRelationship
    declarationReason: str
    declaredAt: str


# 4. Decision Models
class DecisionOutcome(str, Enum):
    ADMIT = "admit"
    DENY = "deny"
    ESCALATE = "escalate"
    CONDITIONAL = "conditional"


class AdmissibilityStatus(str, Enum):
    ADMISSIBLE = "admissible"
    INADMISSIBLE = "inadmissible"
    CONDITIONAL = "conditional"
    PENDING_EVALUATION = "pending_evaluation"


class DecisionRegisterInput(BaseModel):
    decisionType: str = Field(..., min_length=1, max_length=100)
    outcome: DecisionOutcome
    rationale: str = Field(..., min_length=1, max_length=5000)
    contributingClaimIds: List[str] = Field(default_factory=list)
    policyVersionId: Optional[str] = None
    admissibilityStatus: AdmissibilityStatus = AdmissibilityStatus.ADMISSIBLE
    idempotencyKey: Optional[str] = None


class DecisionDTO(BaseModel):
    id: str
    tenantId: str
    decisionType: str
    outcome: DecisionOutcome
    rationale: str
    contributingClaimIds: List[str]
    policyVersionId: Optional[str] = None
    admissibilityStatus: AdmissibilityStatus
    registeredAt: str


# 5. Admissibility Models
class AdmissibilityCheckInput(BaseModel):
    claimVersionId: str
    policyName: Optional[str] = None
    contextParameters: Dict[str, Any] = Field(default_factory=dict)


class AdmissibilityCheckResult(BaseModel):
    evaluationId: str
    claimVersionId: str
    disposition: str
    isAdmissible: bool
    rulesTriggered: List[str]
    reasons: List[str]
    evaluatedAt: str


# 6. Human Review Models
class HumanReviewStatus(str, Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    REASSIGNED = "reassigned"


class HumanReviewPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class HumanReviewRequestInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    summary: str = Field(..., min_length=1, max_length=5000)
    requiredRole: str = Field(default="compliance_officer", min_length=1, max_length=100)
    claimId: Optional[str] = None
    decisionId: Optional[str] = None
    decisionPolicy: Optional[str] = None
    priority: HumanReviewPriority = HumanReviewPriority.MEDIUM
    idempotencyKey: Optional[str] = None


class HumanReviewDTO(BaseModel):
    id: str
    tenantId: str
    title: str
    summary: str
    requiredRole: str
    claimId: Optional[str] = None
    decisionId: Optional[str] = None
    decisionPolicy: Optional[str] = None
    status: HumanReviewStatus
    priority: HumanReviewPriority
    requestedAt: str


# 7. Lineage Impact Models
class LineageImpactReport(BaseModel):
    rootEntityId: str
    rootEntityType: str
    directDependentsCount: int
    totalDownstreamAffectedCount: int
    affectedDecisions: List[Dict[str, Any]] = Field(default_factory=list)
    affectedClaims: List[Dict[str, Any]] = Field(default_factory=list)
    generatedAt: str
