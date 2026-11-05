# Local Development & Infrastructure Guide

This guide details local environment setup, containerized backing services, database migrations, seeding, and execution of development servers for ProofMesh.

---

## 1. Prerequisites & Host Toolchain

Before setting up ProofMesh, verify the host toolchain against the baseline established in [docs/research/repository-audit.md](file:///docs/research/repository-audit.md):

| Component          | Minimum Version | Verified Host Runtime | Purpose                                                       |
| :----------------- | :-------------- | :-------------------- | :------------------------------------------------------------ |
| **Node.js**        | `>= 20.0.0`     | `v26.3.0`             | JavaScript / TypeScript runtime                               |
| **pnpm**           | `>= 9.0.0`      | `11.6.0`              | Fast, disk-efficient package manager with workspace isolation |
| **Docker**         | `>= 24.0.0`     | `29.7.2`              | Container engine for local PostgreSQL 16 backing service      |
| **Docker Compose** | `>= 2.20.0`     | `v2.x`                | Orchestration for multi-container local topologies            |

Verify your environment:

```bash
node -v
pnpm -v
docker --version
docker compose version
```

---

## 2. Environment Configuration

ProofMesh uses strict runtime schema validation powered by Zod (`apps/api/src/config/env.ts`). The application fails fast immediately on startup if required variables are missing or malformed.

1. Copy the example configuration file:

   ```bash
   cp .env.example .env
   ```

2. Review key variables in `.env`:
   ```bash
   NODE_ENV=development
   PORT=4000
   DATABASE_URL=postgresql://proofmesh_user:proofmesh_password@localhost:5432/proofmesh_dev
   JWT_SECRET=super_secret_jwt_key_proofmesh_dev_at_least_16_characters
   FAIL_POLICY=fail_closed
   LOG_LEVEL=info
   VITE_API_URL=http://localhost:4000
   ```

> [!IMPORTANT]
> Never commit `.env` or production credentials to source control. Run `pnpm run secrets:scan` before committing.

---

## 3. Backing Services with Docker Compose

ProofMesh provides Docker Compose configurations for both local development and isolated test execution.

### Local Development Database (PostgreSQL 16)

Start the persistent local development database:

```bash
docker compose up -d postgres
```

This launches PostgreSQL 16 on port `5432` with `uuid-ossp` and `pgcrypto` enabled.

To stop the database:

```bash
docker compose down
```

### Ephemeral Test Database

For integration test isolation, an ephemeral test database running on port `5433` is defined in `docker-compose.test.yml`:

```bash
docker compose -f docker-compose.test.yml up -d
docker compose -f docker-compose.test.yml down -v
```

---

## 4. Database Migrations & Deterministic Seeding

All database schema definitions are versioned as transactional SQL scripts under `packages/db/src/migrations/`.

### Run Pending Migrations

Execute forward migrations against the configured `DATABASE_URL`:

```bash
pnpm --filter @proofmesh/db migrate:up
```

### Rollback Migrations

Roll back the latest migration batch:

```bash
pnpm --filter @proofmesh/db migrate:down
```

### Seed Deterministic Test Fixtures

Populate the database with foundational tenant, workspace, project, and principal records:

```bash
pnpm --filter @proofmesh/db seed
```

---

## 5. Running Development Services

ProofMesh runs as a modular monorepo using pnpm workspaces:

### Install Workspace Dependencies

```bash
pnpm install
```

### Run Backend API (`apps/api`)

```bash
pnpm --filter @proofmesh/api dev
```

The Fastify API server starts at `http://localhost:4000`.

Verify health and readiness probes:

- Liveness: `curl -i http://localhost:4000/healthz`
- Readiness: `curl -i http://localhost:4000/readyz`

### Run Frontend Dashboard (`apps/web`)

```bash
pnpm --filter @proofmesh/web dev
```

The React/Vite development server starts at `http://localhost:5173`.

---

## 6. Engineering Quality & Verification Commands

All quality gates must pass cleanly prior to opening PRs or merging branches:

```bash
# Automated secret scanning
pnpm run secrets:scan

# Code formatting
pnpm run format:check
pnpm run format

# Static analysis and linting
pnpm run lint

# TypeScript project reference typecheck
pnpm run typecheck

# Full test suite execution
pnpm test

# Partitioned test suites
pnpm run test:unit
pnpm run test:contract
pnpm run test:integration
pnpm run test:security
pnpm run test:architecture

# Production build across all workspace projects
pnpm run build
```
