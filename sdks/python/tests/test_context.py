import asyncio
import pytest
from proofmesh.context import (
    WorkflowContext,
    get_workflow_context,
    with_workflow
)


def test_sync_workflow_context():
    assert get_workflow_context() is None

    with with_workflow(workflow_id="wf-123", correlation_id="corr-456") as ctx:
        current = get_workflow_context()
        assert current is not None
        assert current.workflow_id == "wf-123"
        assert current.correlation_id == "corr-456"

    assert get_workflow_context() is None


def test_nested_sync_workflow_context():
    with with_workflow(workflow_id="parent-wf", correlation_id="parent-corr"):
        assert get_workflow_context().workflow_id == "parent-wf"

        with with_workflow(workflow_id="child-wf", correlation_id="child-corr"):
            assert get_workflow_context().workflow_id == "child-wf"

        assert get_workflow_context().workflow_id == "parent-wf"

    assert get_workflow_context() is None


@pytest.mark.asyncio
async def test_async_workflow_context():
    assert get_workflow_context() is None

    async with with_workflow(workflow_id="async-wf-1", correlation_id="async-corr-1"):
        current = get_workflow_context()
        assert current is not None
        assert current.workflow_id == "async-wf-1"

        await asyncio.sleep(0.01)
        assert get_workflow_context().workflow_id == "async-wf-1"

    assert get_workflow_context() is None


@pytest.mark.asyncio
async def test_async_concurrent_workflow_isolation():
    results = {}

    async def task(task_id: str):
        async with with_workflow(workflow_id=f"wf-{task_id}"):
            await asyncio.sleep(0.02)
            results[task_id] = get_workflow_context().workflow_id

    await asyncio.gather(
        task("A"),
        task("B"),
        task("C")
    )

    assert results["A"] == "wf-A"
    assert results["B"] == "wf-B"
    assert results["C"] == "wf-C"
