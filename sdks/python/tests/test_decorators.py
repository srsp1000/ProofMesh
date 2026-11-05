import pytest
from proofmesh.client import ProofMeshClient
from proofmesh.decorators import observe_tool, observe_workflow


class DummyTelemetry:
    def __init__(self):
        self.recorded_spans = []

    def record_span(self, name, start_time_unix_nano, end_time_unix_nano, status, attributes=None, span_id=None):
        self.recorded_spans.append({
            "name": name,
            "status": status,
            "attributes": attributes or {},
            "span_id": span_id
        })


def test_sync_workflow_decorator():
    client = ProofMeshClient(api_key="test", base_url="http://mock")
    dummy_telemetry = DummyTelemetry()
    client.telemetry = dummy_telemetry

    @observe_workflow(name="calc_workflow", client=client)
    def compute(a: int, b: int) -> int:
        return a + b

    result = compute(10, 20)
    assert result == 30
    assert len(dummy_telemetry.recorded_spans) == 1
    assert dummy_telemetry.recorded_spans[0]["name"] == "workflow:calc_workflow"
    assert dummy_telemetry.recorded_spans[0]["status"] == "ok"


def test_sync_workflow_decorator_error():
    client = ProofMeshClient(api_key="test", base_url="http://mock")
    dummy_telemetry = DummyTelemetry()
    client.telemetry = dummy_telemetry

    @observe_workflow(name="failing_workflow", client=client)
    def fail():
        raise ValueError("Calculation failed")

    with pytest.raises(ValueError):
        fail()

    assert len(dummy_telemetry.recorded_spans) == 1
    assert dummy_telemetry.recorded_spans[0]["name"] == "workflow:failing_workflow"
    assert dummy_telemetry.recorded_spans[0]["status"] == "error"
    assert "Calculation failed" in dummy_telemetry.recorded_spans[0]["attributes"]["error.message"]


@pytest.mark.asyncio
async def test_async_workflow_and_tool_decorators():
    client = ProofMeshClient(api_key="test", base_url="http://mock")
    dummy_telemetry = DummyTelemetry()
    client.telemetry = dummy_telemetry

    @observe_tool(name="fetch_user_data", client=client)
    async def fetch_tool(user_id: str):
        return {"user_id": user_id, "score": 99}

    @observe_workflow(name="agent_flow", client=client)
    async def run_flow(user_id: str):
        return await fetch_tool(user_id)

    res = await run_flow("user-1")
    assert res["score"] == 99

    assert len(dummy_telemetry.recorded_spans) == 2
    names = [s["name"] for s in dummy_telemetry.recorded_spans]
    assert "tool:fetch_user_data" in names
    assert "workflow:agent_flow" in names
