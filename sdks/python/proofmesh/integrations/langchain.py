import time
import uuid
from typing import Any, Dict, Optional, Union

from proofmesh.client import AsyncProofMeshClient, ProofMeshClient


class ProofMeshLangChainCallbackHandler:
    """LangChain callback handler that records workflow, chain, tool, and LLM telemetry
    into ProofMesh with explicit 'captured' provenance.
    """

    def __init__(self, client: Union[ProofMeshClient, AsyncProofMeshClient]) -> None:
        self.client = client
        self._active_runs: Dict[str, Dict[str, Any]] = {}

    def on_chain_start(
        self,
        serialized: Optional[Dict[str, Any]],
        inputs: Dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        tags: Optional[list] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any
    ) -> None:
        name = (serialized or {}).get("name") or "Chain"
        self._active_runs[str(run_id)] = {
            "name": name,
            "kind": "chain",
            "start_time_unix_nano": int(time.time() * 1_000_000_000),
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
            "metadata": metadata or {}
        }

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        **kwargs: Any
    ) -> None:
        run = self._active_runs.pop(str(run_id), None)
        if not run:
            return

        end_nano = int(time.time() * 1_000_000_000)
        self.client.telemetry.record_span(
            name=f"langchain.chain:{run['name']}",
            start_time_unix_nano=run["start_time_unix_nano"],
            end_time_unix_nano=end_nano,
            status="ok",
            attributes={
                "langchain.run_id": str(run_id),
                "langchain.parent_run_id": run.get("parent_run_id") or "",
                "proofmesh.capture_method": "captured",
                **run["metadata"]
            },
            span_id=str(run_id).replace("-", "")[:16]
        )

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        **kwargs: Any
    ) -> None:
        run = self._active_runs.pop(str(run_id), None)
        if not run:
            return

        end_nano = int(time.time() * 1_000_000_000)
        self.client.telemetry.record_span(
            name=f"langchain.chain:{run['name']}",
            start_time_unix_nano=run["start_time_unix_nano"],
            end_time_unix_nano=end_nano,
            status="error",
            attributes={
                "langchain.run_id": str(run_id),
                "error.message": str(error),
                "proofmesh.capture_method": "captured",
                **run["metadata"]
            },
            span_id=str(run_id).replace("-", "")[:16]
        )

    def on_tool_start(
        self,
        serialized: Optional[Dict[str, Any]],
        input_str: str,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        tags: Optional[list] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any
    ) -> None:
        name = (serialized or {}).get("name") or "Tool"
        self._active_runs[str(run_id)] = {
            "name": name,
            "kind": "tool",
            "start_time_unix_nano": int(time.time() * 1_000_000_000),
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
            "metadata": metadata or {}
        }

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        **kwargs: Any
    ) -> None:
        run = self._active_runs.pop(str(run_id), None)
        if not run:
            return

        end_nano = int(time.time() * 1_000_000_000)
        self.client.telemetry.record_span(
            name=f"langchain.tool:{run['name']}",
            start_time_unix_nano=run["start_time_unix_nano"],
            end_time_unix_nano=end_nano,
            status="ok",
            attributes={
                "langchain.run_id": str(run_id),
                "proofmesh.capture_method": "captured",
                **run["metadata"]
            },
            span_id=str(run_id).replace("-", "")[:16]
        )

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        **kwargs: Any
    ) -> None:
        run = self._active_runs.pop(str(run_id), None)
        if not run:
            return

        end_nano = int(time.time() * 1_000_000_000)
        self.client.telemetry.record_span(
            name=f"langchain.tool:{run['name']}",
            start_time_unix_nano=run["start_time_unix_nano"],
            end_time_unix_nano=end_nano,
            status="error",
            attributes={
                "langchain.run_id": str(run_id),
                "error.message": str(error),
                "proofmesh.capture_method": "captured",
                **run["metadata"]
            },
            span_id=str(run_id).replace("-", "")[:16]
        )

    def on_llm_start(
        self,
        serialized: Optional[Dict[str, Any]],
        prompts: list,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        tags: Optional[list] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any
    ) -> None:
        name = (serialized or {}).get("name") or "LLM"
        self._active_runs[str(run_id)] = {
            "name": name,
            "kind": "llm",
            "start_time_unix_nano": int(time.time() * 1_000_000_000),
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
            "metadata": metadata or {}
        }

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        **kwargs: Any
    ) -> None:
        run = self._active_runs.pop(str(run_id), None)
        if not run:
            return

        end_nano = int(time.time() * 1_000_000_000)
        self.client.telemetry.record_span(
            name=f"langchain.llm:{run['name']}",
            start_time_unix_nano=run["start_time_unix_nano"],
            end_time_unix_nano=end_nano,
            status="ok",
            attributes={
                "langchain.run_id": str(run_id),
                "proofmesh.capture_method": "captured",
                **run["metadata"]
            },
            span_id=str(run_id).replace("-", "")[:16]
        )

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: uuid.UUID,
        parent_run_id: Optional[uuid.UUID] = None,
        **kwargs: Any
    ) -> None:
        run = self._active_runs.pop(str(run_id), None)
        if not run:
            return

        end_nano = int(time.time() * 1_000_000_000)
        self.client.telemetry.record_span(
            name=f"langchain.llm:{run['name']}",
            start_time_unix_nano=run["start_time_unix_nano"],
            end_time_unix_nano=end_nano,
            status="error",
            attributes={
                "langchain.run_id": str(run_id),
                "error.message": str(error),
                "proofmesh.capture_method": "captured",
                **run["metadata"]
            },
            span_id=str(run_id).replace("-", "")[:16]
        )
