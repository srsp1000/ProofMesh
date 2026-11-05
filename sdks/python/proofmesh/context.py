import contextvars
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class WorkflowContext:
    workflow_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    correlation_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: Optional[str] = field(default_factory=lambda: uuid.uuid4().hex)
    span_id: Optional[str] = field(default_factory=lambda: uuid.uuid4().hex[:16])
    parent_span_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


_current_workflow_context: contextvars.ContextVar[Optional[WorkflowContext]] = (
    contextvars.ContextVar("proofmesh_workflow_context", default=None)
)


def get_workflow_context() -> Optional[WorkflowContext]:
    """Returns the active workflow context for the current async task/thread."""
    return _current_workflow_context.get()


def set_workflow_context(context: WorkflowContext) -> contextvars.Token:
    """Sets the active workflow context."""
    return _current_workflow_context.set(context)


def reset_workflow_context(token: contextvars.Token) -> None:
    """Resets the workflow context back to previous state."""
    _current_workflow_context.reset(token)


class with_workflow:
    """Context manager for scoping execution within a workflow context.
    Supports both sync (`with with_workflow(...)`) and async (`async with with_workflow(...)`).
    """

    def __init__(
        self,
        context: Optional[WorkflowContext] = None,
        workflow_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if context is not None:
            self.context = context
        else:
            self.context = WorkflowContext(
                workflow_id=workflow_id or str(uuid.uuid4()),
                correlation_id=correlation_id or str(uuid.uuid4()),
                metadata=metadata or {},
            )
        self._token: Optional[contextvars.Token] = None

    def __enter__(self) -> WorkflowContext:
        self._token = _current_workflow_context.set(self.context)
        return self.context

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._token is not None:
            _current_workflow_context.reset(self._token)
            self._token = None

    async def __aenter__(self) -> WorkflowContext:
        return self.__enter__()

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.__exit__(exc_type, exc_val, exc_tb)
