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


# 8. Source Models
class SourceType(str, Enum):
    WEB_PAGE = "web_page"
    PDF = "pdf"
    DOCX = "docx"
    MARKDOWN = "markdown"
    PLAIN_TEXT = "plain_text"
    CODE_REPOSITORY = "code_repository"
    API_RESPONSE = "api_response"
    STRUCTURED_RECORD = "structured_record"


class SourceRetentionState(str, Enum):
    ACTIVE = "active"
    SOFT_DELETED = "soft_deleted"
    PURGED = "purged"
    LEGAL_HOLD = "legal_hold"


class SourcePermissionContext(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


class SourceArtifactDTO(BaseModel):
    id: str
    tenantId: str
    projectId: str
    originalUri: str
    resolvedUri: str
    sourceType: SourceType
    title: str
    issuer: Optional[str] = None
    mimeType: str
    permissionContext: SourcePermissionContext
    retentionState: SourceRetentionState
    metadata: Dict[str, Any] = Field(default_factory=dict)
    createdAt: str
    updatedAt: str


class SourceVersionDTO(BaseModel):
    id: str
    tenantId: str
    sourceArtifactId: str
    versionHash: str
    byteSize: int
    storageLocation: str
    versionIdentifiers: Dict[str, Any] = Field(default_factory=dict)
    publicationDate: Optional[str] = None
    retrievalTimestamp: str
    httpValidators: Optional[Dict[str, Any]] = None
    extractionStatus: str = "completed"
    parserMetadata: Dict[str, Any] = Field(default_factory=dict)
    capturedAt: str
    recordedAt: str


class SourcePassageDTO(BaseModel):
    id: str
    tenantId: str
    sourceVersionId: str
    passageIndex: int
    contentText: str
    contentHash: str
    charStart: Optional[int] = None
    charEnd: Optional[int] = None
    locator: Dict[str, Any]
    extractionMethod: str
    ocrConfidence: Optional[float] = None
    createdAt: str


class SourceSnapshotDTO(BaseModel):
    id: str
    tenantId: str
    snapshotHash: str
    sourceVersionIds: List[str]
    totalByteSize: int
    manifest: Dict[str, Any] = Field(default_factory=dict)
    createdAt: str


# 9. Claim Intelligence Models
class PropositionType(str, Enum):
    FACTUAL_CLAIM = "factual_claim"
    OPINION = "opinion"
    FORECAST = "forecast"
    COMMITMENT = "commitment"
    INSTRUCTION = "instruction"


class ConfidenceCategory(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class MaterialProposition(BaseModel):
    id: str
    propositionType: PropositionType
    rawStatement: str
    normalizedSubject: str
    normalizedPredicate: str
    normalizedObject: str
    normalizedUnit: Optional[str] = None
    qualifiers: Dict[str, Any] = Field(default_factory=dict)
    sourcePassageId: Optional[str] = None
    confidenceScore: float
    confidenceCategory: ConfidenceCategory


class ClaimExtractionResult(BaseModel):
    extractionId: str
    sourceVersionId: Optional[str] = None
    propositions: List[MaterialProposition]
    coverageScore: float
    rejectedSegments: List[Dict[str, str]] = Field(default_factory=list)
    modelMetadata: Dict[str, Any] = Field(default_factory=dict)
    promptTemplateVersion: str
    extractedAt: str


class ClaimOccurrenceDTO(BaseModel):
    id: str
    tenantId: str
    claimVersionId: str
    sourceVersionId: Optional[str] = None
    sourcePassageId: Optional[str] = None
    agentActivityId: Optional[str] = None
    contextPacketId: Optional[str] = None
    exactPassageText: str
    charStart: Optional[int] = None
    charEnd: Optional[int] = None
    occurredAt: str
    recordedAt: str


class ClaimCorrectionDTO(BaseModel):
    id: str
    tenantId: str
    claimVersionId: str
    correctedByPrincipalId: str
    fieldName: str
    originalValue: str
    correctedValue: str
    correctionReason: str
    correctedAt: str


class DuplicateConceptCandidate(BaseModel):
    conceptId: str
    conceptKey: str
    similarityScore: float
    scopeDifferences: List[str] = Field(default_factory=list)
    canMerge: bool
