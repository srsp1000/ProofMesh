from typing import Any, Optional


class ProofMeshError(Exception):
    """Base exception for all ProofMesh SDK errors."""
    pass


class ProofMeshApiError(ProofMeshError):
    """Raised when ProofMesh API returns an error response."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Optional[Any] = None
    ) -> None:
        super().__init__(f"[{code}] {message} (HTTP {status_code})")
        self.status_code = status_code
        self.code = code
        self.details = details


class ProofMeshTimeoutError(ProofMeshError):
    """Raised when a request to ProofMesh times out."""

    def __init__(self, timeout_seconds: float, operation: str) -> None:
        super().__init__(f"Operation '{operation}' timed out after {timeout_seconds}s")
        self.timeout_seconds = timeout_seconds
        self.operation = operation


class ProofMeshValidationError(ProofMeshError):
    """Raised when payload validation fails locally before request."""

    def __init__(self, message: str, issues: Optional[Any] = None) -> None:
        super().__init__(message)
        self.issues = issues or []
