#!/usr/bin/env node

/**
 * Layer import-direction checker.
 *
 * `check-feature-boundaries.mjs` governs what happens *inside* src/features:
 * features may only reach each other through their `deps/*` adapters. This
 * checker governs every other layer, which that script never scans:
 *
 *   - the app bootstrap, the router, the headless harness and the shared test
 *     setup are composition roots: they assemble features and are exempt.
 *   - shared/, infrastructure/, components/, config/, types/, i18n/ and data/
 *     are the layers *below* features and must never depend on features,
 *     runtime, app or routes.
 *   - runtime/ sits between them: it consumes feature state, but only through
 *     the same `runtime/<engine>/deps/*-contract.ts` seam that features use for
 *     each other.
 *   - `@/lib/*` was removed from the tree; the ban is kept so it cannot come
 *     back.
 *
 * Every rule here was verified clean against the tree when it was added, so the
 * checker is a regression guard rather than a backlog. Aliases *and* relative
 * specifiers are resolved, which is why this exists next to the oxlint
 * no-restricted-imports matrix rather than replacing it.
 *
 * Known limitation: generated specifiers (template literals inside import())
 * are invisible to static collection, as in the feature checker.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  collectSourceFiles,
  collectSpecifiers,
  normalizePath,
  resolveRelativeSpecifier,
  stripQueryAndHash,
} from './feature-import-utils.mjs';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');

/**
 * Entry points that compose features by design, and are therefore allowed to
 * import feature internals directly. Each of these assembles features rather
 * than living inside one:
 *
 *   - src/main.tsx           app bootstrap (pre-reload project save, updates)
 *   - src/app.tsx, src/app/  app shell; src/app/debug is a dev-only escape
 *                            hatch that reaches into stores on purpose, so
 *                            routing it through contracts would mean adding
 *                            debug-only exports to every feature
 *   - src/bootstrap.ts       bootstrap wiring
 *   - src/routes/            TanStack route modules; one route mounts one feature
 *   - src/headless/          UI-less render harness, reuses the export engine
 *   - src/test/              shared test setup
 */
const COMPOSITION_ROOT_PATTERNS = [
  /^src\/app\.tsx$/,
  /^src\/app\//,
  /^src\/bootstrap\.ts$/,
  /^src\/main\.tsx$/,
  /^src\/routes\//,
  /^src\/headless\//,
  /^src\/test\//,
];

/** Layers below features, and the layers each may not import. */
const FORBIDDEN_DOWNWARD_IMPORTS = {
  // shared/ui legitimately composes the shadcn kit, so components/ stays open.
  shared: ['features', 'runtime', 'app', 'routes'],
  infrastructure: ['features', 'runtime', 'app', 'routes', 'components'],
  components: ['features', 'runtime', 'app', 'routes'],
  config: ['features', 'runtime', 'app', 'routes', 'components'],
  types: ['features', 'runtime', 'app', 'routes', 'components'],
  i18n: ['features', 'runtime', 'app', 'routes', 'components'],
  data: ['features', 'runtime', 'app', 'routes', 'components'],
};

/** The only runtime files allowed to import from src/features. */
const RUNTIME_CONTRACT_PATTERN = /^src\/runtime\/.*\/deps\/[^/]*-contract\.ts$/;

function relativeToRoot(absolutePath) {
  return normalizePath(path.relative(ROOT_DIR, absolutePath));
}

function getLayer(relativePath) {
  return relativePath.match(/^src\/([^/]+)\//)?.[1] ?? null;
}

function isCompositionRoot(relativePath) {
  return COMPOSITION_ROOT_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/**
 * Resolve a specifier to the layer it lands in. Alias specifiers carry their
 * layer directly; relative specifiers have to be resolved against the importer
 * so that `../../features/x` is not a way around the rule.
 */
function resolveTargetLayer(fromFile, rawSpecifier) {
  const specifier = stripQueryAndHash(rawSpecifier);

  if (specifier.startsWith('@/')) {
    return specifier.slice(2).split('/')[0] ?? null;
  }

  if (!specifier.startsWith('.')) return null;

  const resolvedPath = resolveRelativeSpecifier(fromFile, specifier);
  if (!resolvedPath) return null;

  return getLayer(relativeToRoot(resolvedPath));
}

function createViolation(rule, file, specifier, message) {
  return { rule, file: relativeToRoot(file), specifier, message };
}

function checkFile(file, violations) {
  const relativePath = relativeToRoot(file);
  const layer = getLayer(relativePath);
  const compositionRoot = isCompositionRoot(relativePath);
  const forbiddenUpward = compositionRoot ? [] : (FORBIDDEN_DOWNWARD_IMPORTS[layer] ?? []);

  const source = fs.readFileSync(file, 'utf8');

  for (const specifier of collectSpecifiers(source)) {
    if (stripQueryAndHash(specifier).startsWith('@/lib/')) {
      violations.push(
        createViolation(
          'legacy-lib',
          file,
          specifier,
          'The @/lib layer was removed; import from shared/, infrastructure/, runtime/ or the owning feature instead.'
        )
      );
      continue;
    }

    if (compositionRoot) continue;

    const targetLayer = resolveTargetLayer(file, specifier);
    if (!targetLayer) continue;

    if (forbiddenUpward.includes(targetLayer)) {
      violations.push(
        createViolation(
          'layer-direction',
          file,
          specifier,
          `src/${layer}/ is below src/${targetLayer}/ and must not depend on it.`
        )
      );
      continue;
    }

    if (layer === 'features' && (targetLayer === 'app' || targetLayer === 'routes')) {
      violations.push(
        createViolation(
          'layer-direction',
          file,
          specifier,
          `features are composed by src/${targetLayer}/, never the reverse.`
        )
      );
      continue;
    }

    if (
      layer === 'runtime' &&
      targetLayer === 'features' &&
      !RUNTIME_CONTRACT_PATTERN.test(relativePath)
    ) {
      violations.push(
        createViolation(
          'runtime-contract',
          file,
          specifier,
          'runtime/ may only import src/features through runtime/<engine>/deps/*-contract.ts.'
        )
      );
    }
  }
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('Cannot find src directory.');
    process.exit(1);
  }

  const files = collectSourceFiles(SRC_DIR);
  const violations = [];

  for (const file of files) {
    checkFile(file, violations);
  }

  if (violations.length > 0) {
    console.error(`Layer boundary check failed. Found ${violations.length} violation(s):\n`);

    const ordered = violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier)
    );

    for (const violation of ordered) {
      console.error(`- [${violation.rule}] ${violation.file}: "${violation.specifier}"`);
      console.error(`  ${violation.message}`);
    }

    process.exit(1);
  }

  console.log(
    `Layer boundary check passed (${files.length} files scanned): no illegal layer dependencies detected.`
  );
}

main();