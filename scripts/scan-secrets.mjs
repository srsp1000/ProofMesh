#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';

const SECRET_PATTERNS = [
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'OpenAI Secret Key', regex: /sk-[a-zA-Z0-9]{20,}/ },
  {
    name: 'AWS Access Key ID',
    regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/
  },
  { name: 'GitHub Personal Access Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  {
    name: 'Generic High-Entropy Secret in Variable',
    regex: /(?:secret|password|api_key|apikey|private_key)\s*[:=]\s*['"][a-zA-Z0-9_\-+/]{24,}['"]/i
  }
];

const IGNORED_PATHS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.env.example',
  'scripts/scan-secrets.mjs'
];

let violations = 0;

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(process.cwd(), fullPath);

    if (
      IGNORED_PATHS.some((ignored) => relPath === ignored || relPath.startsWith(ignored + path.sep))
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile()) {
      scanFile(fullPath, relPath);
    }
  }
}

function scanFile(fullPath, relPath) {
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip false positives in audit documentation commands and test fixtures
      if (line.includes('grep -rn') || line.includes('test_secret') || line.includes('dummy_')) {
        continue;
      }
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          console.error(`[SECRET SCAN FAILURE] ${pattern.name} found in ${relPath}:${i + 1}`);
          violations++;
        }
      }
    }
  } catch {
    // Ignore binary or unreadable files
  }
}

console.info('Starting ProofMesh automated secret scan...');
scanDir(process.cwd());

if (violations > 0) {
  console.error(`\nSecret scan failed: ${violations} potential secret(s) found!`);
  process.exit(1);
} else {
  console.info('Secret scan passed: 0 secrets detected.');
  process.exit(0);
}
