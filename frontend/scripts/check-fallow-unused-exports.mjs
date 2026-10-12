#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const ALLOWLIST_PATH = path.join(ROOT_DIR, 'scripts', 'fallow-unused-exports.allowlist.json');
const FALLOW_PACKAGE = 'fallow@2.89.0';

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function keyFor(pathName, exportName) {
  return `${normalizePath(pathName)}#${exportName}`;
}

function loadAllowlist() {
  const source = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
  const parsed = JSON.parse(source);
  const entries = parsed.unusedExports;
  if (!Array.isArray(entries)) {
    throw new Error('Allowlist must contain an unusedExports array.');
  }

  const seen = new Set();
  return entries.map((entry, index) => {
    const pathName = entry.path;
    const exportName = entry.exportName;
    const reason = entry.reason;
    if (!pathName || !exportName || !reason) {
      throw new Error(`Allowlist entry ${index + 1} must include path, exportName, and reason.`);
    }

    const key = keyFor(pathName, exportName);
    if (seen.has(key)) {
      throw new Error(`Duplicate allowlist entry: ${key}`);
    }
    seen.add(key);

    return {
      key,
      path: normalizePath(pathName),
      exportName,
      reason,
    };
  });
}

function runFallowDeadCode() {
  const npmExecPath = process.env.npm_execpath;
  const hasNpmExecPath = Boolean(npmExecPath && fs.existsSync(npmExecPath));
  const command = hasNpmExecPath ? process.execPath : 'npx';
  const args = hasNpmExecPath
    ? [npmExecPath, 'exec', '--yes', '--', FALLOW_PACKAGE, 'dead-code', '--format', 'json', '--quiet']
    : ['--yes', FALLOW_PACKAGE, 'dead-code', '--format', 'json', '--quiet'];
  const needsShell = !hasNpmExecPath && process.platform === 'win32';

  const result = spawnSync(
    command,
    args,
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      shell: needsShell,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && result.status !== 1) {
    const stderr = result.stderr.trim();
    throw new Error(`fallow dead-code failed with status ${result.status}${stderr ? `:\n${stderr}` : ''}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error('fallow dead-code did not return JSON output.');
  }

  return JSON.parse(stdout);
}

function formatFinding(finding) {
  const line = Number.isInteger(finding.line) ? `:${finding.line}` : '';
  return `${normalizePath(finding.path)}${line} ${finding.export_name}`;
}

function main() {
  const allowlist = loadAllowlist();
  const allowlistByKey = new Map(allowlist.map((entry) => [entry.key, entry]));
  const report = runFallowDeadCode();
  const unusedExports = report.unused_exports ?? report.unusedExports ?? [];

  const findings = unusedExports.map((finding) => ({
    ...finding,
    key: keyFor(finding.path, finding.export_name),
  }));
  const findingKeys = new Set(findings.map((finding) => finding.key));
  const newFindings = findings.filter((finding) => !allowlistByKey.has(finding.key));
  const staleEntries = allowlist.filter((entry) => !findingKeys.has(entry.key));

  console.log(
    `Fallow unused exports: ${findings.length} findings, ${findings.length - newFindings.length} allowlisted, ${newFindings.length} new, ${staleEntries.length} stale.`
  );

  if (newFindings.length > 0) {
    console.error('\nNew unused exports:');
    for (const finding of newFindings) {
      console.error(`- ${formatFinding(finding)}`);
    }
  }

  if (staleEntries.length > 0) {
    console.error('\nStale allowlist entries:');
    for (const entry of staleEntries) {
      console.error(`- ${entry.path} ${entry.exportName}`);
    }
  }

  if (newFindings.length > 0 || staleEntries.length > 0) {
    console.error('\nUpdate scripts/fallow-unused-exports.allowlist.json after reviewing the changed export surface.');
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
