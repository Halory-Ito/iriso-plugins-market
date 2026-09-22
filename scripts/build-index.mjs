#!/usr/bin/env bun
/**
 * Builds `index.json` — the single file the app downloads.
 *
 * The index is a pure function of `plugins/`: no timestamps, so `--check` can
 * prove in CI that the committed index still matches the committed packages.
 * Every plugin contributes its highest version; older versions stay on disk so
 * the app can pin or roll back by path.
 *
 * Usage:
 *   bun scripts/build-index.mjs            # sync hashes, write index.json
 *   bun scripts/build-index.mjs --check    # fail when index.json is stale
 *
 * Env:
 *   MARKET_BASE_URL  optional; when set, absolute packageUrl/scriptUrl are
 *                    added (e.g. a jsDelivr url pinned to a commit).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { verifyAll } from './verify-plugin.mjs';
import {
  SANDBOX_API_VERSION,
  byteSize,
  compareVersions,
  listPackageDirs,
  loadPackage,
  readJson,
  sha256,
  writeJson,
} from './lib/packages.mjs';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const indexPath = path.join(root, 'index.json');

/** `https://host/base/` -> `https://host/base/plugins/...` */
function joinUrl(base, relative) {
  return `${base.replace(/\/+$/, '')}/${relative}`;
}

/**
 * Writes the real script hash back into every `plugin.json`, so authors never
 * hand-compute it. Skipped in `--check` mode (CI must not mutate the tree).
 */
async function syncHashes() {
  for (const dir of await listPackageDirs(root)) {
    const packageFile = path.join(dir, 'plugin.json');
    const pkg = await readJson(packageFile);
    const script = await readFile(path.join(dir, pkg.runtime?.script ?? 'script.js'), 'utf8');
    const hash = sha256(script);

    if (pkg.runtime?.sha256 === hash) continue;

    pkg.runtime = { ...pkg.runtime, sha256: hash };
    await writeJson(packageFile, pkg);
    console.log(`  hash updated: ${path.relative(root, packageFile)}`);
  }
}

if (!checkOnly) await syncHashes();

const { errors } = await verifyAll(root);
if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`);
  console.error('\nrefusing to build an index from invalid packages');
  process.exit(1);
}

const baseUrl = process.env.MARKET_BASE_URL ?? null;
const latest = new Map();

for (const dir of await listPackageDirs(root)) {
  const loaded = await loadPackage(dir);
  const current = latest.get(loaded.pkg.id);

  if (!current || compareVersions(loaded.pkg.version, current.pkg.version) > 0) {
    latest.set(loaded.pkg.id, loaded);
  }
}

const plugins = [...latest.values()]
  .map(({ pkg, script }) => {
    const packagePath = `plugins/${pkg.id}/${pkg.version}/plugin.json`;
    const scriptPath = `plugins/${pkg.id}/${pkg.version}/script.js`;

    return {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      apiVersion: pkg.apiVersion,
      minAppVersion: pkg.minAppVersion,
      description: pkg.description ?? '',
      author: pkg.author ?? '',
      homepage: pkg.homepage ?? null,
      languages: pkg.languages ?? [],
      capabilities: pkg.capabilities,
      deprecated: pkg.deprecated === true,
      packagePath,
      scriptPath,
      scriptSha256: sha256(script),
      scriptSize: byteSize(script),
      ...(baseUrl
        ? { packageUrl: joinUrl(baseUrl, packagePath), scriptUrl: joinUrl(baseUrl, scriptPath) }
        : {}),
    };
  })
  .sort((left, right) => left.id.localeCompare(right.id));

const index = { schema: 1, apiVersion: SANDBOX_API_VERSION, plugins };

if (checkOnly) {
  const committed = await readJson(indexPath).catch(() => null);
  const expected = JSON.stringify(index, null, 2);

  if (!committed || JSON.stringify(committed, null, 2) !== expected) {
    console.error('✗ index.json is stale — run `bun run index` and commit the result');
    process.exit(1);
  }

  console.log(`✓ index.json matches ${plugins.length} package(s)`);
} else {
  await writeJson(indexPath, index);
  console.log(`✓ index.json written with ${plugins.length} plugin(s)`);

  for (const plugin of plugins) {
    console.log(`  ${plugin.id}@${plugin.version}  ${plugin.scriptSize} bytes`);
  }
}
