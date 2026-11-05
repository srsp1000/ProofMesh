import logging
import threading
import time
import uuid
from typing import Any, Dict, List, Optional
import httpx

from proofmesh.context import get_workflow_context, WorkflowContext

logger = logging.getLogger("proofmesh.telemetry")


class TelemetrySpanItem:
    def __init__(
        self,
        name: str,
        start_time_unix_nano: int,
        end_time_unix_nano: int,
        status: str = "ok",
        attributes: Optional[Dict[str, Any]] = None,
        workflow_context: Optional[WorkflowContext] = None,
        span_id: Optional[str] = None
    ) -> None:
        self.span_id = span_id or uuid.uuid4().hex[:16]
        self.name = name
        self.start_time_unix_nano = start_time_unix_nano
        self.end_time_unix_nano = end_time_unix_nano
        self.status = status
        self.attributes = attributes or {}
        self.workflow_context = workflow_context


class TelemetryBuffer:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        tenant_id: Optional[str] = None,
        max_batch_size: int = 50,
        flush_interval_seconds: float = 2.0
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.tenant_id = tenant_id
        self.max_batch_size = max_batch_size
        self.flush_interval_seconds = flush_interval_seconds

        self._buffer: List[TelemetrySpanItem] = []
        self._lock = threading.Lock()
        self._is_running = True
        self._flush_thread = threading.Thread(target=self._flusher_loop, daemon=True)
        self._flush_thread.start()

    def record_span(
        self,
        name: str,
        start_time_unix_nano: int,
        end_time_unix_nano: int,
        status: str = "ok",
        attributes: Optional[Dict[str, Any]] = None,
        span_id: Optional[str] = None
    ) -> None:
        if not self._is_running:
            return

        ctx = get_workflow_context()
        span = TelemetrySpanItem(
            name=name,
            start_time_unix_nano=start_time_unix_nano,
            end_time_unix_nano=end_time_unix_nano,
            status=status,
            attributes=attributes,
            workflow_context=ctx,
            span_id=span_id
        )

        should_flush = False
        with self._lock:
            self._buffer.append(span)
            if len(self._buffer) >= self.max_batch_size:
                should_flush = True

        if should_flush:
            self.flush()

    def flush(self) -> None:
        with self._lock:
            if not self._buffer:
                return
            items_to_send = self._buffer[:]
            self._buffer.clear()

        try:
            spans_payload = []
            for s in items_to_send:
                trace_id = s.workflow_context.trace_id if s.workflow_context and s.workflow_context.trace_id else uuid.uuid4().hex
                span_id = s.span_id
                parent_span_id = s.workflow_context.parent_span_id if s.workflow_context else None

                attrs = [
                    {"key": "proofmesh.correlation_id", "value": {"stringValue": s.workflow_context.correlation_id if s.workflow_context else ""}},
                    {"key": "proofmesh.workflow_id", "value": {"stringValue": s.workflow_context.workflow_id if s.workflow_context else ""}},
                ]
                for k, v in (s.attributes or {}).items():
                    attrs.append({"key": str(k), "value": {"stringValue": str(v)}})

                span_dict = {
                    "traceId": trace_id,
                    "spanId": span_id,
                    "name": s.name,
                    "kind": 1,
                    "startTimeUnixNano": str(s.start_time_unix_nano),
                    "endTimeUnixNano": str(s.end_time_unix_nano),
                    "attributes": attrs,
                    "status": {"code": 1 if s.status == "ok" else 2}
                }
                if parent_span_id:
                    span_dict["parentSpanId"] = parent_span_id
                spans_payload.append(span_dict)

            payload = {
                "resourceSpans": [
                    {
                        "resource": {
                            "attributes": [
                                {"key": "service.name", "value": {"stringValue": "proofmesh-python-sdk"}},
                                {"key": "telemetry.sdk.language", "value": {"stringValue": "python"}}
                            ]
                        },
                        "scopeSpans": [
                            {
                                "scope": {"name": "proofmesh.python.telemetry", "version": "1.0.0"},
                                "spans": spans_payload
                            }
                        ]
                    }
                ]
            }

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }
            if self.tenant_id:
                headers["X-Tenant-ID"] = self.tenant_id

            with httpx.Client(timeout=3.0) as client:
                res = client.post(
                    f"{self.base_url}/v1/adapters/opentelemetry/v1/traces",
                    headers=headers,
                    json=payload
                )
                if res.status_code >= 400:
                    logger.warning(f"Telemetry flush failed with status HTTP {res.status_code}")
        except Exception as e:
            logger.warning(f"Failed to send telemetry batch to ProofMesh (fail-open): {e}")

    def _flusher_loop(self) -> None:
        while self._is_running:
            time.sleep(self.flush_interval_seconds)
            self.flush()

    def close(self) -> None:
        self._is_running = False
        self.flush()
