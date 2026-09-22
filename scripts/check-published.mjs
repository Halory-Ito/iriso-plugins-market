#!/usr/bin/env bun
/**
 * Rejects edits to an already published version.
 *
 * A published `<id>@<version>` may already be cached by users, so its bytes must
 * never change: bump the version instead.
 *
 * Usage: bun scripts/check-published.mjs --against <git-ref>
 */
const root = process.cwd();
const flag = process.argv.indexOf('--against');
const base = flag > -1 ? process.argv[flag + 1] : 'origin/main';

function git(args) {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  return result.success ? result.stdout.toString() : null;
}

if (git(['rev-parse', '--verify', base]) === null) {
  console.warn(`! base ref "${base}" not found — skipping the published-version check`);
  process.exit(0);
}

/** `plugins/<id>/<version>/plugin.json` -> `<id>@<version>` */
function versionOf(file) {
  const [plugins, id, version] = file.split('/');
  return plugins === 'plugins' && id && version ? `${id}@${version}` : null;
}

const published = new Set(
  (git(['ls-tree', '-r', '--name-only', base, '--', 'plugins/']) ?? '')
    .split('\n')
    .map(versionOf)
    .filter(Boolean)
);

const changed = (git(['diff', '--name-only', base, 'HEAD', '--', 'plugins/']) ?? '')
  .split('\n')
  .filter(Boolean);

const offenders = new Set(changed.map(versionOf).filter((key) => key && published.has(key)));

if (offenders.size > 0) {
  for (const offender of offenders) {
    console.error(`✗ ${offender} was already published — publish a new version instead`);
  }
  process.exit(1);
}

console.log(`✓ no published version was modified (${published.size} published)`);
