import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getFilesRecursively(dir: string, extensions: string[] = ['.ts', '.tsx']): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.turbo') {
        files.push(...getFilesRecursively(fullPath, extensions));
      }
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architectural Boundary & Integrity Constraints', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('ensures packages/domain has zero transport or web framework imports', () => {
    const domainSrc = path.join(rootDir, 'packages/domain/src');
    const domainFiles = getFilesRecursively(domainSrc);
    expect(domainFiles.length).toBeGreaterThan(0);

    const forbiddenImports = ['fastify', 'express', '@fastify', 'koa', 'react', 'vite'];

    for (const file of domainFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const forbidden of forbiddenImports) {
        const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g');
        expect(
          regex.test(content),
          `Domain file ${path.relative(rootDir, file)} must not import transport framework '${forbidden}'`
        ).toBe(false);
      }
    }
  });

  it('ensures packages/contracts has zero database or domain dependencies', () => {
    const contractsSrc = path.join(rootDir, 'packages/contracts/src');
    const contractFiles = getFilesRecursively(contractsSrc);
    expect(contractFiles.length).toBeGreaterThan(0);

    const forbiddenImports = ['@proofmesh/domain', '@proofmesh/db', 'pg', 'pg-pool'];

    for (const file of contractFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const forbidden of forbiddenImports) {
        const regex = new RegExp(`from\\s+['"]${forbidden}(/.*)?['"]`, 'g');
        expect(
          regex.test(content),
          `Contracts file ${path.relative(rootDir, file)} must not import '${forbidden}'`
        ).toBe(false);
      }
    }
  });

  it('ensures zero placeholder markers or stubs in production source files', () => {
    const prodDirs = [
      path.join(rootDir, 'packages/contracts/src'),
      path.join(rootDir, 'packages/domain/src'),
      path.join(rootDir, 'packages/db/src'),
      path.join(rootDir, 'apps/api/src'),
      path.join(rootDir, 'apps/web/src')
    ];

    const allProdFiles = prodDirs.flatMap((dir) => getFilesRecursively(dir));
    expect(allProdFiles.length).toBeGreaterThan(0);

    const forbiddenMarkers = [
      /\bTODO\b/i,
      /\bFIXME\b/i,
      /\bMOCK_DATA\b/i,
      /\bPLACEHOLDER\b/i,
      /\bNOT_IMPLEMENTED\b/i
    ];

    const violations: { file: string; line: number; marker: string }[] = [];

    for (const file of allProdFiles) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        for (const marker of forbiddenMarkers) {
          if (marker.test(line)) {
            violations.push({
              file: path.relative(rootDir, file),
              line: idx + 1,
              marker: marker.source
            });
          }
        }
      });
    }

    expect(
      violations,
      `Detected placeholder or incomplete code markers in production source:\n${JSON.stringify(violations, null, 2)}`
    ).toEqual([]);
  });

  it('ensures database migrations enforce tenant isolation and audit immutability', () => {
    const migrationFile = path.join(rootDir, 'packages/db/src/migrations/0001_initial_schema.sql');
    expect(fs.existsSync(migrationFile)).toBe(true);

    const migrationContent = fs.readFileSync(migrationFile, 'utf-8');

    // Tenant isolation verification
    expect(migrationContent).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migrationContent).toContain('app.current_tenant_id');

    // Immutability trigger verification
    expect(migrationContent).toContain('block_mutation_on_immutable_table');
    expect(migrationContent).toContain('BEFORE UPDATE OR DELETE ON audit_events');
    expect(migrationContent).toContain('BEFORE UPDATE OR DELETE ON evidence_items');
  });
});
