#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BASE_REF = 'origin/staging';
const FALLOW_PACKAGE = 'fallow@2.89.0';

function getBaseRef() {
  const baseFlagIndex = process.argv.indexOf('--base');
  if (baseFlagIndex >= 0) {
    const value = process.argv[baseFlagIndex + 1];
    if (!value) {
      throw new Error('Missing value for --base.');
    }
    return value;
  }

  return process.env.FALLOW_AUDIT_BASE || DEFAULT_BASE_REF;
}

function valueOrDefault(value, fallback) {
  return value ?? fallback;
}

function parseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('fallow audit did not return JSON output.');
  }
  return JSON.parse(trimmed);
}

function getNpmExecPath() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return npmExecPath;
  }

  const nodeDir = path.dirname(process.execPath);
  const bundledNpmPath = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(bundledNpmPath) ? bundledNpmPath : '';
}

// Headless drivers run under `node --test`, so Vitest coverage never sees them
// and every headless function scores as uncovered in CRAP. `npm run
// coverage:headless` writes this file; when it is present we hand it to Fallow
// so complexity findings reflect real coverage instead of an assumed zero.
const HEADLESS_COVERAGE_PATH = path.join(process.cwd(), '.coverage', 'headless.json');

/**
 * Ignore a coverage feed that predates the sources it claims to describe:
 * scoring today's code with yesterday's coverage can let a genuinely uncovered
 * function inherit "covered" data. Only the files the feed actually contains
 * matter, so editing the bench or a test does not invalidate it.
 */
function coverageIsStale(coveragePath) {
  const collectedAt = fs.statSync(coveragePath).mtimeMs;
  let scored;
  try {
    scored = Object.keys(JSON.parse(fs.readFileSync(coveragePath, 'utf8')));
  } catch {
    return 'unreadable';
  }
  for (const file of scored) {
    if (!fs.existsSync(file)) return `covered file is gone: ${path.basename(file)}`;
    if (fs.statSync(file).mtimeMs > collectedAt) {
      return `${path.basename(file)} changed after collection`;
    }
  }
  return null;
}

function coverageArgs() {
  if (!fs.existsSync(HEADLESS_COVERAGE_PATH)) return [];
  const stale = coverageIsStale(HEADLESS_COVERAGE_PATH);
  if (stale) {
    console.warn(
      `Ignoring .coverage/headless.json (${stale}).\n` +
        'Run `npm run coverage:headless` to refresh it.'
    );
    return [];
  }
  const ageHours = (Date.now() - fs.statSync(HEADLESS_COVERAGE_PATH).mtimeMs) / 3_600_000;
  console.log(`Using .coverage/headless.json (collected ${ageHours.toFixed(1)}h ago).`);
  return ['--coverage', HEADLESS_COVERAGE_PATH];
}

function createFallowCommand(baseRef) {
  const fallowArgs = ['audit', '--format', 'json', '--quiet', '--base', baseRef, ...coverageArgs()];
  const npmExecPath = getNpmExecPath();
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, 'exec', '--yes', '--', FALLOW_PACKAGE, ...fallowArgs],
      shell: false,
    };
  }

  return {
    command: 'npx',
    args: ['--yes', FALLOW_PACKAGE, ...fallowArgs],
    shell: process.platform === 'win32',
  };
}

function execFallowAudit(baseRef) {
  const fallowCommand = createFallowCommand(baseRef);
  return spawnSync(fallowCommand.command, fallowCommand.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: fallowCommand.shell,
  });
}

function runFallowAudit(baseRef) {
  const result = execFallowAudit(baseRef);
  if (result.error) {
    throw result.error;
  }

  if (!result.stdout.trim()) {
    const stderr = result.stderr.trim();
    throw new Error(`fallow audit did not return JSON output${stderr ? `:\n${stderr}` : '.'}`);
  }

  const report = parseJson(result.stdout);
  if (report.error) {
    throw new Error(report.message || 'fallow audit failed.');
  }
  return report;
}

function printReport(report, baseRef) {
  const attribution = valueOrDefault(report.attribution, {});
  const changedFilesCount = valueOrDefault(report.changed_files_count, 0);
  const baseLabel = valueOrDefault(report.base_ref, baseRef);
  const deadCodeIntroduced = valueOrDefault(attribution.dead_code_introduced, 0);
  const complexityIntroduced = valueOrDefault(attribution.complexity_introduced, 0);
  const duplicationIntroduced = valueOrDefault(attribution.duplication_introduced, 0);
  console.log(
    `Fallow changed health: ${report.verdict} (${changedFilesCount} changed files, base ${baseLabel}).`
  );
  console.log(
    `Introduced: dead_code=${deadCodeIntroduced}, complexity=${complexityIntroduced}, duplication=${duplicationIntroduced}.`
  );
}

function printFailureReport(report) {
  console.error('\nChanged-code health gate failed. Summary:');
  console.error(JSON.stringify({
    summary: report.summary,
    attribution: report.attribution,
  }, null, 2));
}

function main() {
  const baseRef = getBaseRef();
  const report = runFallowAudit(baseRef);

  printReport(report, baseRef);

  if (report.verdict === 'pass') {
    return;
  }

  printFailureReport(report);
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
