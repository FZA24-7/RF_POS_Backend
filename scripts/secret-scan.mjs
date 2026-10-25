#!/usr/bin/env node
// Scans tracked source/config files for accidentally-committed secrets.
// Deliberately dependency-free so it can run before `pnpm install` too.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-pure',
  'build',
  'coverage',
  '.turbo',
  'generated',
  'release',
  'out',
]);

const IGNORED_FILES = new Set(['pnpm-lock.yaml', '.env.example']);

// Real, structural secret patterns - not "the word password appears".
const PATTERNS = [
  {
    name: 'Generic API key assignment',
    re: /(api|secret|access)[_-]?key\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/gi,
  },
  { name: 'AWS Access Key ID', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private key block', re: /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----/g },
  {
    name: 'JWT-looking literal',
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: 'Postgres/MySQL URL with embedded credentials',
    re: /(postgres|postgresql|mysql):\/\/[^:\s'"]+:[^@\s'"]+@[^\s'"]+/gi,
  },
  {
    name: 'Hardcoded bcrypt/argon2 hash literal assigned to a "password" field',
    re: /password\s*[:=]\s*['"]\$(2[aby]|argon2)/gi,
  },
];

// Lines that are clearly placeholders/examples are allowed even if they match a pattern loosely.
const ALLOW_SUBSTRINGS = [
  'dev-only-local-secret',
  'mafk_local_dev',
  'YOUR_',
  '<',
  'example.com',
  'placeholder',
];

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.env',
  '.yaml',
  '.yml',
  '.md',
  '.prisma',
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (!IGNORED_FILES.has(entry)) {
      files.push(full);
    }
  }
  return files;
}

function isTextFile(path) {
  const ext = path.slice(path.lastIndexOf('.'));
  return TEXT_EXTENSIONS.has(ext) || path.endsWith('.env');
}

function scan() {
  const files = walk(ROOT).filter(isTextFile);
  const findings = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    // .env itself (not .env.example) is a real local secret file - it must not be scanned INTO the
    // repo state as "clean" content, it must simply not exist inside a distributable ZIP. We flag
    // its presence here so the packaging step is forced to notice it.
    if (/(^|\/)\.env$/.test(rel)) {
      findings.push({ file: rel, name: 'Untracked .env file present (must be excluded from ZIP)' });
      continue;
    }
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { name, re } of PATTERNS) {
      const matches = content.match(re);
      if (!matches) continue;
      for (const m of matches) {
        if (ALLOW_SUBSTRINGS.some((allowed) => m.includes(allowed))) continue;
        findings.push({ file: rel, name, sample: m.slice(0, 40) });
      }
    }
  }
  return findings;
}

const findings = scan();
if (findings.length > 0) {
  console.error(`Secret scan FAILED - ${findings.length} finding(s):`);
  for (const f of findings) {
    console.error(`  - [${f.name}] ${f.file}${f.sample ? ` :: ${f.sample}...` : ''}`);
  }
  process.exit(1);
}
console.log('Secret scan PASSED - no committed secrets found.');
