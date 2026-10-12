#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const ALLOWLIST_PATH = path.join(ROOT_DIR, 'scripts', 'fallow-unused-class-members.allowlist.json');
const FALLOW_PACKAGE = 'fallow@2.89.0';

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function memberKey(parentName, memberName, kind) {
  return `${parentName}#${memberName}#${kind}`;
}

function findingKey(finding) {
  return memberKey(finding.parent_name, finding.member_name, finding.kind);
}

function loadAllowlist() {
  const source = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
  const parsed = JSON.parse(source);
  const groups = parsed.unusedClassMembers;
  if (!Array.isArray(groups)) {
    throw new Error('Allowlist must contain an unusedClassMembers array.');
  }

  const allowlistByPath = new Map();
  for (const [groupIndex, group] of groups.entries()) {
    const pathName = group.path;
    const members = group.members;
    const reason = group.reason;
    if (!pathName || !Array.isArray(members) || !reason) {
      throw new Error(`Allowlist group ${groupIndex + 1} must include path, members, and reason.`);
    }

    const normalizedPath = normalizePath(pathName);
    if (allowlistByPath.has(normalizedPath)) {
      throw new Error(`Duplicate allowlist path: ${normalizedPath}`);
    }

    const membersByKey = new Map();
    for (const [memberIndex, member] of members.entries()) {
      const parentName = member.parentName;
      const memberName = member.memberName;
      const kind = member.kind;
      const count = member.count ?? 1;
      if (!parentName || !memberName || !kind || !Number.isInteger(count) || count < 1) {
        throw new Error(
          `Allowlist member ${memberIndex + 1} in ${normalizedPath} must include parentName, memberName, kind, and an optional positive integer count.`
        );
      }

      const key = memberKey(parentName, memberName, kind);
      if (membersByKey.has(key)) {
        throw new Error(`Duplicate allowlist member: ${normalizedPath} ${key}`);
      }
      membersByKey.set(key, { parentName, memberName, kind, count });
    }

    allowlistByPath.set(normalizedPath, {
      path: normalizedPath,
      reason,
      membersByKey,
    });
  }

  return allowlistByPath;
}

function runFallowDeadCode() {
  const npmExecPath = process.env.npm_execpath;
  const hasNpmExecPath = Boolean(npmExecPath && fs.existsSync(npmExecPath));
  const command = hasNpmExecPath ? process.execPath : 'npx';
  const args = hasNpmExecPath
    ? [
        npmExecPath,
        'exec',
        '--yes',
        '--',
        FALLOW_PACKAGE,
        'dead-code',
        '--format',
        'json',
        '--quiet',
        '--unused-class-members',
      ]
    : [
        '--yes',
        FALLOW_PACKAGE,
        'dead-code',
        '--format',
        'json',
        '--quiet',
        '--unused-class-members',
      ];
  const needsShell = !hasNpmExecPath && process.platform === 'win32';

  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: needsShell,
  });

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
  return `${normalizePath(finding.path)}${line} ${finding.parent_name}.${finding.member_name} [${finding.kind}]`;
}

function formatAllowlistMember(pathName, member) {
  const suffix = member.count > 1 ? ` x${member.count}` : '';
  return `${pathName} ${member.parentName}.${member.memberName} [${member.kind}]${suffix}`;
}

function groupFindings(findings) {
  const byPath = new Map();
  for (const finding of findings) {
    const pathName = normalizePath(finding.path);
    let group = byPath.get(pathName);
    if (!group) {
      group = {
        path: pathName,
        findings: [],
        membersByKey: new Map(),
      };
      byPath.set(pathName, group);
    }

    group.findings.push(finding);
    const key = findingKey(finding);
    const entry = group.membersByKey.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      group.membersByKey.set(key, {
        parentName: finding.parent_name,
        memberName: finding.member_name,
        kind: finding.kind,
        count: 1,
      });
    }
  }
  return byPath;
}

function main() {
  const allowlistByPath = loadAllowlist();
  const report = runFallowDeadCode();
  const unusedClassMembers = report.unused_class_members ?? report.unusedClassMembers ?? [];
  const findingsByPath = groupFindings(unusedClassMembers);

  const newFindings = [];
  const changedCounts = [];
  const staleEntries = [];

  for (const [pathName, findingGroup] of findingsByPath.entries()) {
    const allowlistGroup = allowlistByPath.get(pathName);
    if (!allowlistGroup) {
      newFindings.push(...findingGroup.findings);
      continue;
    }

    for (const finding of findingGroup.findings) {
      if (!allowlistGroup.membersByKey.has(findingKey(finding))) {
        newFindings.push(finding);
      }
    }

    for (const [key, findingMember] of findingGroup.membersByKey.entries()) {
      const allowedMember = allowlistGroup.membersByKey.get(key);
      if (allowedMember && allowedMember.count !== findingMember.count) {
        changedCounts.push({
          path: pathName,
          allowed: allowedMember,
          actual: findingMember,
        });
      }
    }
  }

  for (const [pathName, allowlistGroup] of allowlistByPath.entries()) {
    const findingGroup = findingsByPath.get(pathName);
    if (!findingGroup) {
      for (const member of allowlistGroup.membersByKey.values()) {
        staleEntries.push({ path: pathName, member });
      }
      continue;
    }

    for (const [key, member] of allowlistGroup.membersByKey.entries()) {
      if (!findingGroup.membersByKey.has(key)) {
        staleEntries.push({ path: pathName, member });
      }
    }
  }

  const allowlistedCount = unusedClassMembers.length - newFindings.length;
  console.log(
    `Fallow unused class members: ${unusedClassMembers.length} findings, ${allowlistedCount} allowlisted, ${newFindings.length} new, ${staleEntries.length} stale, ${changedCounts.length} changed counts.`
  );

  if (newFindings.length > 0) {
    console.error('\nNew unused class members:');
    for (const finding of newFindings) {
      console.error(`- ${formatFinding(finding)}`);
    }
  }

  if (changedCounts.length > 0) {
    console.error('\nChanged allowlist counts:');
    for (const entry of changedCounts) {
      console.error(
        `- ${formatAllowlistMember(entry.path, entry.allowed)} now reports x${entry.actual.count}`
      );
    }
  }

  if (staleEntries.length > 0) {
    console.error('\nStale allowlist entries:');
    for (const entry of staleEntries) {
      console.error(`- ${formatAllowlistMember(entry.path, entry.member)}`);
    }
  }

  if (newFindings.length > 0 || staleEntries.length > 0 || changedCounts.length > 0) {
    console.error(
      '\nUpdate scripts/fallow-unused-class-members.allowlist.json after reviewing the changed class-member surface.'
    );
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
