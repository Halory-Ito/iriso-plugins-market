import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Sandbox contract version this market publishes for. */
export const SANDBOX_API_VERSION = 1;

/** Hard cap so a package can never stall the sandbox WebView. */
export const MAX_SCRIPT_BYTES = 256 * 1024;

/** Signature envelope written to `index.json.sig`. */
export const KEY_ID = 'iriso-market-1';

/**
 * Capability -> endpoints the script must register for it.
 * Kept in sync with `ImageSourcePlugin` in the app.
 */
export const CAPABILITY_METHODS = {
  featured: ['getDiscoveryList'],
  search: ['searchAlbums'],
  album: ['getAlbum', 'getAlbumImages'],
  tag: ['getTags'],
};

/** Endpoints a sandbox script may register at all. */
export const KNOWN_METHODS = [
  'getDiscoveryList',
  'searchAlbums',
  'getAlbum',
  'getAlbumImages',
  'getImage',
  'getImageOriginal',
  'getImageDetail',
  'getTags',
  'getFeatured',
  'search',
];

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function byteSize(text) {
  return Buffer.byteLength(text, 'utf8');
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Every `plugins/<id>/<version>` directory, sorted by path. */
export async function listPackageDirs(root) {
  const pluginsDir = path.join(root, 'plugins');
  const ids = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  const dirs = [];

  for (const id of ids) {
    if (!id.isDirectory()) continue;
    const versions = await readdir(path.join(pluginsDir, id.name), { withFileTypes: true });

    for (const version of versions) {
      if (version.isDirectory()) dirs.push(path.join(pluginsDir, id.name, version.name));
    }
  }

  return dirs.sort();
}

/** Reads one package plus its script. */
export async function loadPackage(dir) {
  const pkg = await readJson(path.join(dir, 'plugin.json'));
  const script = await readFile(path.join(dir, pkg.runtime?.script ?? 'script.js'), 'utf8');
  return { pkg, script };
}

/** Relative, forward-slash path used inside the index. */
export function toPosixPath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

/** `1.2.10` > `1.2.9`; pre-release suffixes sort below the release. */
export function compareVersions(a, b) {
  const parse = (value) => value.split('-')[0].split('.').map(Number);
  const left = parse(a);
  const right = parse(b);

  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0);
  }

  return a.includes('-') === b.includes('-') ? 0 : a.includes('-') ? -1 : 1;
}
