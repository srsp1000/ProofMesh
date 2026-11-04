# Code Quality Rules

These rules govern code standards, styling, validation, and maintainability across ProofMesh.

## 1. Strict Typing & Validation
- **Strict Types**: Always compile with strict mode enabled (`strict: true` in `tsconfig.json` or `--strict` in `mypy`). Avoid `any`, `unknown` as an escape hatch, or unsafe type assertions (`as Type`) without runtime guards.
- **Runtime Validation at Trust Boundaries**: All incoming requests, headers, query parameters, external API responses, and database inputs must be validated at runtime using strict schemas (e.g., Zod).
- **Domain Modeling**: Express business rules through typed domain entities and value objects, leveraging discriminated unions and branded types where appropriate.

## 2. Zero Incomplete Code
- **No Stubs or TODOs in Production**: Code committed to production branches must be fully implemented, functional, and covered by tests. Never leave `TODO`, `FIXME`, empty functions, or stub handlers.
- **No Swallowed Exceptions**: Never use empty catch blocks or catch-all exception swallowers. Either handle errors gracefully with typed error representations or rethrow/log with full context.
- **Dead Code Prohibition**: Remove unused imports, dead variables, deprecated unreferenced code, and commented-out blocks.

## 3. Modularity & Readability
- **Small & Cohesive**: Keep functions focused on a single responsibility. Avoid god-objects and monolithic modules.
- **Meaningful Names**: Use descriptive, domain-aligned names for variables, types, and functions. Avoid abbreviations and ambiguous identifiers.
- **Intent-Focused Comments**: Comment *why* a complex decision was made, not *what* standard code does.
