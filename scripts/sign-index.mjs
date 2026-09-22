#!/usr/bin/env bun
/**
 * Signs `index.json` with Ed25519, or verifies an existing signature.
 *
 * The app pins `keys/market-public.pem`; the private key only ever lives in
 * `.secrets/` (gitignored) or in the `MARKET_SIGNING_KEY` secret.
 *
 * Usage:
 *   bun scripts/sign-index.mjs            # write index.json.sig (skips when no key)
 *   bun scripts/sign-index.mjs --verify   # verify index.json.sig, fail on mismatch
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

import { KEY_ID, writeJson } from './lib/packages.mjs';

const root = process.cwd();
const indexFile = path.join(root, 'index.json');
const sigFile = path.join(root, 'index.json.sig');
const publicKeyFile = path.join(root, 'keys/market-public.pem');
const privateKeyFile = path.join(root, '.secrets/market-signing-key.pem');

const verifyOnly = process.argv.includes('--verify');

async function loadPrivateKey() {
  const fromEnv = process.env.MARKET_SIGNING_KEY;
  if (fromEnv) {
    const pem = fromEnv.includes('-----BEGIN')
      ? fromEnv
      : Buffer.from(fromEnv, 'base64').toString('utf8');
    return createPrivateKey(pem);
  }

  try {
    return createPrivateKey(await readFile(privateKeyFile, 'utf8'));
  } catch {
    return null;
  }
}

const bytes = await readFile(indexFile).catch(() => null);
if (!bytes) {
  console.error('✗ index.json is missing — run `bun run index` first');
  process.exit(1);
}

if (verifyOnly) {
  const envelope = JSON.parse(await readFile(sigFile, 'utf8'));
  const publicKey = createPublicKey(await readFile(publicKeyFile, 'utf8'));
  const ok = verify(null, bytes, publicKey, Buffer.from(envelope.sig, 'base64'));

  if (!ok) {
    console.error('✗ index.json.sig does not match index.json');
    process.exit(1);
  }

  console.log(`✓ index.json.sig valid (keyId ${envelope.keyId})`);
} else {
  const privateKey = await loadPrivateKey();

  if (!privateKey) {
    console.warn('! no signing key (MARKET_SIGNING_KEY or .secrets/…) — index left unsigned');
    process.exit(0);
  }

  const signature = sign(null, bytes, privateKey);
  await writeJson(sigFile, {
    alg: 'ed25519',
    keyId: KEY_ID,
    sig: Buffer.from(signature).toString('base64'),
  });

  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  await writeFile(publicKeyFile, publicKey, 'utf8');

  console.log(`✓ index.json.sig written (keyId ${KEY_ID})`);
}
