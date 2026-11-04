# Operations & Reliability Runbooks

This directory contains operational procedures, infrastructure definitions, monitoring runbooks, and failure behavior specifications.

## Scope
- **Configuration & Secrets**: Reference for environment variables, secrets management, and configuration profiles.
- **Fail-Open / Fail-Closed Policies**: Explicit operational runbooks documenting failure behavior when external dependencies, model providers, or databases fail.
- **Health Checks & Observability**: Specifications for `/healthz`, `/livez`, OpenTelemetry metrics, and structured log formatting.
- **Incident Response & Recovery**: Runbooks for data recovery, replay of dead-letter queues, and node failovers.
