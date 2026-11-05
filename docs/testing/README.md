# Testing Strategy & Verification Standards

This directory outlines the comprehensive testing strategy, quality assurance criteria, test fixtures, and performance benchmarks for ProofMesh.

## Testing Taxonomy

1. **Unit Testing**: Isolated verification of domain models, application services, and business rules.
2. **Contract & Schema Testing**: Automated validation of API schemas, payload deserialization, and boundary constraints.
3. **Integration Testing**: End-to-end slice verification against real databases, queues, and containerized dependencies.
4. **Negative & Edge Testing**: Fuzzing, malicious payload injection, unauthorized tenant access attempts, and duplicate delivery tests.
5. **No Test Weakening Rule**: Strict prohibition against deleting or weakening tests to achieve passing builds.
