#!/usr/bin/env bun
/**
 * Validates every package under `plugins/`.
 *
 * Rules mirror `schema/plugin.schema.json`, plus the checks a JSON Schema cannot
 * express: script hash/size/syntax, sandbox compliance (network only through
 * `ctx.fetch`, no host globals) and "declared capabilities == registered
 * endpoints".
 *
 * Usage: bun scripts/verify-plugin.mjs
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  CAPABILITY_METHODS,
  KNOWN_METHODS,
  MAX_SCRIPT_BYTES,
  SANDBOX_API_VERSION,
  byteSize,
  listPackageDirs,
  loadPackage,
  sha256,
} from './lib/packages.mjs';

/**
 * Plugin ids: lowercase segments joined by `-` or `.`, e.g. `wallhaven`,
 * `my-plugin`, `com.example.wallhaven`.
 *
 * There is deliberately no `builtin.` / `community.` prefix: the market no
 * longer separates first- from third-party packages.
 */
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;

/**
 * Standard setting keys the host owns (mirrors the app's
 * `features/plugins/settings/catalog.ts`; keep the two lists in sync).
 *
 * A package that declares one of these opts into the host's control, wording and
 * value domain — it supplies no `label` / `type` of its own.
 */
const STANDARD_SETTING_KEYS = ['contentRating', 'endpoints', 'imageQuality', 'pageSize'];

/** Field types the host can render for plugin-specific settings. */
const SETTING_TYPES = ['text', 'number', 'boolean', 'select', 'secret', 'textarea', 'json'];

/** Settings-page sections; empty ones are not rendered. */
const SETTING_SECTIONS = ['content', 'network', 'quality', 'advanced'];

/** `builtin.` / `community.` were retired with the source-prefix convention. */
const RETIRED_ID_PREFIX = /^(builtin|community)\./;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const HOST_PATTERN = /^[a-z0-9.-]+$/;

/** Patterns that must never appear in a sandbox script. */
const FORBIDDEN = [
  [/(?<![.\w$])fetch\s*\(/, 'bare fetch() — use ctx.fetch()'],
  [/\brequire\s*\(/, 'require() is unavailable in the sandbox'],
  [/\bimport\s*\(/, 'dynamic import() is unavailable in the sandbox'],
  [/\beval\s*\(/, 'eval() is not allowed'],
  [/new\s+Function\b/, 'new Function() is not allowed'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest is unavailable — use ctx.fetch()'],
  [/\blocalStorage\b/, 'localStorage is unavailable'],
  [/\bdocument\./, 'DOM access is unavailable'],
];

/**
 * Runs the script against a stub `window.iriso` and returns what it registered.
 * This is how a package proves which endpoints it really implements.
 */
function loadRegisteredSources(script) {
  const registered = [];
  const stub = { iriso: { registerSource: (source) => registered.push(source) } };

  // Plugin scripts are self-contained IIFEs that talk to `window.iriso`.
  const run = new Function('window', 'self', 'globalThis', script);
  run(stub, stub, stub);

  return registered;
}

function checkPackage(root, dir, errors) {
  const relative = path.relative(root, dir).split(path.sep).join('/');
  const fail = (message) => errors.push(`${relative}: ${message}`);

  return loadPackage(dir).then(async ({ pkg, script }) => {
    const [idFromPath, versionFromPath] = relative.split('/').slice(1);

    if (!ID_PATTERN.test(pkg.id ?? '')) fail(`invalid id "${pkg.id}"`);
    if (RETIRED_ID_PREFIX.test(pkg.id ?? '')) {
      fail(`id "${pkg.id}" uses a retired "builtin." / "community." prefix`);
    }
    if (pkg.id !== idFromPath) fail(`directory id "${idFromPath}" != manifest id "${pkg.id}"`);
    if (!SEMVER_PATTERN.test(pkg.version ?? '')) fail(`invalid version "${pkg.version}"`);
    if (pkg.version !== versionFromPath) fail(`directory version != manifest version`);
    if (pkg.apiVersion !== SANDBOX_API_VERSION) {
      fail(`apiVersion ${pkg.apiVersion} != sandbox api ${SANDBOX_API_VERSION}`);
    }
    if (!SEMVER_PATTERN.test(pkg.minAppVersion ?? '')) fail('minAppVersion must be a version');
    if (!Array.isArray(pkg.capabilities) || pkg.capabilities.length === 0) {
      fail('capabilities must not be empty');
    }

    const runtime = pkg.runtime ?? {};
    if (runtime.type !== 'sandbox') fail('runtime.type must be "sandbox"');
    if (runtime.script !== 'script.js') fail('runtime.script must be "script.js"');
    if (!/^https:\/\//.test(runtime.baseUrl ?? '')) fail('runtime.baseUrl must be https');
    if (!Array.isArray(runtime.hosts) || runtime.hosts.length === 0) fail('runtime.hosts is empty');
    for (const host of runtime.hosts ?? []) {
      if (!HOST_PATTERN.test(host)) fail(`invalid host "${host}"`);
    }

    const size = byteSize(script);
    if (size > MAX_SCRIPT_BYTES) fail(`script is ${size} bytes (max ${MAX_SCRIPT_BYTES})`);
    if (runtime.sha256 !== sha256(script)) {
      fail(`runtime.sha256 does not match script.js (expected ${sha256(script)})`);
    }

    // Optional icon, rendered by the app with react-native-svg.
    if (pkg.icon !== undefined) {
      if (typeof pkg.icon !== 'string' || !pkg.icon.endsWith('.svg')) {
        fail('icon must point at an .svg file');
      } else {
        const icon = await readFile(path.join(dir, pkg.icon), 'utf8').catch(() => null);
        if (icon === null) fail(`icon file ${pkg.icon} is missing`);
        else if (!/<svg[\s>]/.test(icon)) fail(`icon file ${pkg.icon} is not an SVG document`);
      }
    }

    // Settings are rendered by the app and passed to the script as ctx.settings,
    // so every declared field must be one the script actually reads.
    const settings = pkg.settings ?? [];
    if (!Array.isArray(settings)) {
      fail('settings must be an array');
    } else {
      const keys = new Set();

      for (const field of settings) {
        if (typeof field?.key !== 'string' || field.key === '') {
          fail('every setting needs a string key');
          continue;
        }
        if (keys.has(field.key)) fail(`duplicate setting key "${field.key}"`);
        keys.add(field.key);

        // A standard key is owned by the host: no label / type of its own.
        if (field.kind === 'standard') {
          if (!STANDARD_SETTING_KEYS.includes(field.key)) {
            fail(`standard setting "${field.key}" is not in the host catalog`);
          }
        } else {
          if (typeof field.label !== 'string' || field.label === '') {
            fail(`setting "${field.key}" needs a label`);
          }
          if (!SETTING_TYPES.includes(field.type)) {
            fail(`setting "${field.key}" has unsupported type "${field.type}"`);
          }
          if (field.type === 'select' && !Array.isArray(field.options)) {
            fail(`select setting "${field.key}" needs options`);
          }
        }

        if (field.section !== undefined && !SETTING_SECTIONS.includes(field.section)) {
          fail(`setting "${field.key}" has unknown section "${field.section}"`);
        }
        if (field.visibleWhen !== undefined) {
          const gate = field.visibleWhen;
          if (typeof gate?.key !== 'string' || !('equals' in gate)) {
            fail(`setting "${field.key}" needs visibleWhen { key, equals }`);
          } else if (!settings.some((other) => other?.key === gate.key)) {
            fail(`setting "${field.key}" gates on undeclared key "${gate.key}"`);
          }
        }
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
          fail(`setting "${field.key}" has min > max`);
        }
        if (!script.includes(field.key)) {
          fail(`setting "${field.key}" is never read by the script`);
        }
      }
    }

    for (const [pattern, reason] of FORBIDDEN) {
      if (pattern.test(script)) fail(`script uses ${reason}`);
    }

    try {
      new Function(script);
    } catch (error) {
      fail(`script does not parse: ${error.message}`);
      return;
    }

    let registered;
    try {
      registered = loadRegisteredSources(script);
    } catch (error) {
      fail(`script threw while registering: ${error.message}`);
      return;
    }

    if (registered.length !== 1) {
      fail(`script registered ${registered.length} sources (expected exactly 1)`);
      return;
    }

    const source = registered[0];
    if (source.id !== pkg.id) fail(`registered id "${source.id}" != package id "${pkg.id}"`);

    const methods = Object.keys(source).filter((key) => typeof source[key] === 'function');
    for (const method of methods) {
      if (!KNOWN_METHODS.includes(method)) fail(`registers unknown endpoint "${method}"`);
    }

    for (const capability of pkg.capabilities ?? []) {
      const required = CAPABILITY_METHODS[capability];
      if (!required) {
        fail(`unknown capability "${capability}"`);
        continue;
      }
      for (const method of required) {
        if (!methods.includes(method)) fail(`capability "${capability}" needs ${method}()`);
      }
    }
  });
}

export async function verifyAll(root) {
  const dirs = await listPackageDirs(root);
  const errors = [];

  if (dirs.length === 0) errors.push('no packages found under plugins/');

  for (const dir of dirs) {
    await checkPackage(root, dir, errors);
  }

  return { dirs, errors };
}

if (import.meta.main) {
  const root = process.cwd();
  const { dirs, errors } = await verifyAll(root);

  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    console.error(`\n${errors.length} problem(s) in ${dirs.length} package(s)`);
    process.exit(1);
  }

  console.log(`✓ ${dirs.length} package(s) valid`);
}
