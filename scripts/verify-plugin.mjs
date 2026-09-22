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

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/;
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

  return loadPackage(dir).then(({ pkg, script }) => {
    const [idFromPath, versionFromPath] = relative.split('/').slice(1);

    if (!ID_PATTERN.test(pkg.id ?? '')) fail(`invalid id "${pkg.id}"`);
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
