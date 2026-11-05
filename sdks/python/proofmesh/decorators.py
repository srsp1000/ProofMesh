import functools
import inspect
import time
import uuid
from typing import Any, Callable, Optional, Union

from proofmesh.client import AsyncProofMeshClient, ProofMeshClient
from proofmesh.context import WorkflowContext, get_workflow_context, with_workflow

_global_client: Optional[Union[ProofMeshClient, AsyncProofMeshClient]] = None


def set_global_client(client: Union[ProofMeshClient, AsyncProofMeshClient]) -> None:
    global _global_client
    _global_client = client


def get_global_client() -> Optional[Union[ProofMeshClient, AsyncProofMeshClient]]:
    return _global_client


def observe_workflow(
    name: Optional[str] = None,
    client: Optional[Union[ProofMeshClient, AsyncProofMeshClient]] = None
) -> Callable:
    """Decorator to observe workflow execution with automated telemetry recording."""
    def decorator(func: Callable) -> Callable:
        workflow_name = name or func.__name__

        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                cli = client or _global_client
                current_ctx = get_workflow_context()
                workflow_id = current_ctx.workflow_id if current_ctx else str(uuid.uuid4())
                correlation_id = current_ctx.correlation_id if current_ctx else str(uuid.uuid4())
                trace_id = current_ctx.trace_id if current_ctx else uuid.uuid4().hex
                span_id = uuid.uuid4().hex[:16]

                new_ctx = WorkflowContext(
                    workflow_id=workflow_id,
                    correlation_id=correlation_id,
                    trace_id=trace_id,
                    span_id=span_id,
                    parent_span_id=current_ctx.span_id if current_ctx else None,
                    metadata={"workflow_name": workflow_name}
                )

                start_nano = int(time.time() * 1_000_000_000)
                async with with_workflow(new_ctx):
                    try:
                        res = await func(*args, **kwargs)
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"workflow:{workflow_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="ok",
                                attributes={"proofmesh.workflow_name": workflow_name},
                                span_id=span_id
                            )
                        return res
                    except Exception as exc:
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"workflow:{workflow_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="error",
                                attributes={
                                    "proofmesh.workflow_name": workflow_name,
                                    "error.message": str(exc)
                                },
                                span_id=span_id
                            )
                        raise
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                cli = client or _global_client
                current_ctx = get_workflow_context()
                workflow_id = current_ctx.workflow_id if current_ctx else str(uuid.uuid4())
                correlation_id = current_ctx.correlation_id if current_ctx else str(uuid.uuid4())
                trace_id = current_ctx.trace_id if current_ctx else uuid.uuid4().hex
                span_id = uuid.uuid4().hex[:16]

                new_ctx = WorkflowContext(
                    workflow_id=workflow_id,
                    correlation_id=correlation_id,
                    trace_id=trace_id,
                    span_id=span_id,
                    parent_span_id=current_ctx.span_id if current_ctx else None,
                    metadata={"workflow_name": workflow_name}
                )

                start_nano = int(time.time() * 1_000_000_000)
                with with_workflow(new_ctx):
                    try:
                        res = func(*args, **kwargs)
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"workflow:{workflow_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="ok",
                                attributes={"proofmesh.workflow_name": workflow_name},
                                span_id=span_id
                            )
                        return res
                    except Exception as exc:
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"workflow:{workflow_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="error",
                                attributes={
                                    "proofmesh.workflow_name": workflow_name,
                                    "error.message": str(exc)
                                },
                                span_id=span_id
                            )
                        raise
            return sync_wrapper

    return decorator


def observe_tool(
    name: Optional[str] = None,
    client: Optional[Union[ProofMeshClient, AsyncProofMeshClient]] = None
) -> Callable:
    """Decorator to observe tool execution with automated telemetry recording."""
    def decorator(func: Callable) -> Callable:
        tool_name = name or func.__name__

        if inspect.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                cli = client or _global_client
                current_ctx = get_workflow_context()
                span_id = uuid.uuid4().hex[:16]
                child_ctx = WorkflowContext(
                    workflow_id=current_ctx.workflow_id if current_ctx else str(uuid.uuid4()),
                    correlation_id=current_ctx.correlation_id if current_ctx else str(uuid.uuid4()),
                    trace_id=current_ctx.trace_id if current_ctx else uuid.uuid4().hex,
                    span_id=span_id,
                    parent_span_id=current_ctx.span_id if current_ctx else None,
                    metadata={"tool_name": tool_name}
                )

                start_nano = int(time.time() * 1_000_000_000)
                async with with_workflow(child_ctx):
                    try:
                        res = await func(*args, **kwargs)
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"tool:{tool_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="ok",
                                attributes={"proofmesh.tool_name": tool_name},
                                span_id=span_id
                            )
                        return res
                    except Exception as exc:
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"tool:{tool_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="error",
                                attributes={
                                    "proofmesh.tool_name": tool_name,
                                    "error.message": str(exc)
                                },
                                span_id=span_id
                            )
                        raise
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                cli = client or _global_client
                current_ctx = get_workflow_context()
                span_id = uuid.uuid4().hex[:16]
                child_ctx = WorkflowContext(
                    workflow_id=current_ctx.workflow_id if current_ctx else str(uuid.uuid4()),
                    correlation_id=current_ctx.correlation_id if current_ctx else str(uuid.uuid4()),
                    trace_id=current_ctx.trace_id if current_ctx else uuid.uuid4().hex,
                    span_id=span_id,
                    parent_span_id=current_ctx.span_id if current_ctx else None,
                    metadata={"tool_name": tool_name}
                )

                start_nano = int(time.time() * 1_000_000_000)
                with with_workflow(child_ctx):
                    try:
                        res = func(*args, **kwargs)
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"tool:{tool_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="ok",
                                attributes={"proofmesh.tool_name": tool_name},
                                span_id=span_id
                            )
                        return res
                    except Exception as exc:
                        end_nano = int(time.time() * 1_000_000_000)
                        if cli:
                            cli.telemetry.record_span(
                                name=f"tool:{tool_name}",
                                start_time_unix_nano=start_nano,
                                end_time_unix_nano=end_nano,
                                status="error",
                                attributes={
                                    "proofmesh.tool_name": tool_name,
                                    "error.message": str(exc)
                                },
                                span_id=span_id
                            )
                        raise
            return sync_wrapper

    return decorator
