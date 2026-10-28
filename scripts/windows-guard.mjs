#!/usr/bin/env node
// Static Windows-compatibility guard. It cannot replace a run on Windows, but it catches the things that break
// a Windows checkout/extraction or the cmd.exe commands, and it runs on any OS (CI, Linux sandbox, Windows).
// Dependency-free. Exit code 1 on any ERROR; warnings never fail the run.
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-pure',
  'build',
  'coverage',
  'generated',
  'release',
  'out',
]);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const BAD_CHARS = /[<>:"|?*]/;
const hasControlChar = (name) => [...name].some((c) => c.charCodeAt(0) < 32);
// Documented, practical budget: Windows MAX_PATH is 260 and node_modules adds ~120 chars below the repo root.
const MAX_RELATIVE_PATH = 120;

const errors = [];
const warnings = [];
const files = [];
const seenLower = new Map();

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join('/');
    const st = lstatSync(full);
    if (st.isSymbolicLink())
      errors.push(`${rel}: symbolic links do not extract reliably on Windows`);
    if (BAD_CHARS.test(name) || hasControlChar(name))
      errors.push(`${rel}: file name contains a character Windows forbids`);
    if (/[. ]$/.test(name))
      errors.push(`${rel}: file name ends with a dot or space (invalid on Windows)`);
    if (RESERVED.test(name)) errors.push(`${rel}: reserved Windows device name`);
    if (rel.length > MAX_RELATIVE_PATH)
      errors.push(`${rel}: path is ${rel.length} chars (budget ${MAX_RELATIVE_PATH})`);
    const lower = rel.toLowerCase();
    if (seenLower.has(lower) && seenLower.get(lower) !== rel) {
      errors.push(
        `${rel}: differs only by case from ${seenLower.get(lower)} (collides on Windows)`,
      );
    }
    seenLower.set(lower, rel);
    if (st.isDirectory()) walk(full);
    else files.push({ full, rel, name });
  }
};
walk(ROOT);

// 1. package.json scripts must be cmd.exe-safe.
const POSIX_ONLY = [
  [/(^|[;&|]\s*)export\s+\w+=/, 'uses `export` (not available in cmd.exe)'],
  [
    /(^|[;&|(]\s*)[A-Za-z_][A-Za-z0-9_]*=\S+\s+[A-Za-z./]/,
    'sets an environment variable inline (VAR=value cmd) - cmd.exe cannot',
  ],
  [/\brm\s+-/, 'uses `rm`'],
  [/\bcp\s+-/, 'uses `cp -`'],
  [/\bmkdir\s+-p\b/, 'uses `mkdir -p`'],
  [/\bcat\s/, 'uses `cat`'],
  [/\$\(|`/, 'uses shell substitution'],
  [/\.sh\b/, 'calls a .sh script'],
  [/(^|\s)\.\/[\w.-]+/, 'runs a ./relative executable'],
];
for (const f of files.filter((x) => x.name === 'package.json')) {
  const scripts = JSON.parse(readFileSync(f.full, 'utf8')).scripts ?? {};
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const [re, why] of POSIX_ONLY)
      if (re.test(cmd)) errors.push(`${f.rel} script "${name}": ${why}`);
  }
}

// 2. No shell scripts are required by the project.
for (const f of files)
  if (/\.(sh|bash)$/i.test(f.name))
    errors.push(`${f.rel}: shell script (the Windows guide is cmd.exe only)`);

// 3. Text files must be LF (Prettier/ESLint run with endOfLine: lf). Warn-level only when the file is not source.
const TEXT =
  /\.(ts|tsx|js|mjs|cjs|json|md|prisma|sql|css|html|yaml|yml|toml|example|editorconfig|gitattributes|gitignore|npmrc|nvmrc|prettierrc|prettierignore)$|^\.[\w.]+$/;
for (const f of files) {
  if (!TEXT.test(f.name)) continue;
  const buf = readFileSync(f.full);
  if (buf.includes(13)) {
    errors.push(
      `${f.rel}: contains CR (CRLF line endings) - Prettier/ESLint would fail on Windows checkouts`,
    );
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) errors.push(`${f.rel}: UTF-8 BOM`);
}

// 4. Required guard files.
for (const need of ['.gitattributes', '.editorconfig', '.npmrc', '.nvmrc']) {
  if (!files.some((f) => f.rel === need)) errors.push(`${need} is missing`);
}
const ga = files.find((f) => f.rel === '.gitattributes');
if (ga && !/eol=lf/.test(readFileSync(ga.full, 'utf8')))
  errors.push('.gitattributes must force eol=lf');
const pr = files.find((f) => f.rel === '.prettierrc.json');
if (pr && JSON.parse(readFileSync(pr.full, 'utf8')).endOfLine !== 'lf')
  errors.push('.prettierrc.json must set "endOfLine": "lf"');

// 5. No hard-coded POSIX absolute paths in source (e.g. /tmp, /home/...).
for (const f of files.filter(
  (x) =>
    /\.(ts|tsx|mjs|js)$/.test(x.name) &&
    !x.rel.includes('/tests/') &&
    x.rel !== 'scripts/windows-guard.mjs',
)) {
  const text = readFileSync(f.full, 'utf8');
  if (/['"`]\/(tmp|home|var|usr|etc)\//.test(text))
    warnings.push(`${f.rel}: hard-coded POSIX path`);
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
if (errors.length) {
  console.error(`\nWindows guard FAILED (${errors.length} error(s)).`);
  process.exit(1);
}
console.log(
  `Windows guard PASSED - ${files.length} files checked (names, path length, case collisions, symlinks, CRLF, cmd.exe-safe scripts).`,
);
