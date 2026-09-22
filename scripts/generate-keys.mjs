#!/usr/bin/env bun
/**
 * Generates the market signing keypair once.
 *
 * - private key -> `.secrets/market-signing-key.pem` (gitignored; move it to the
 *   `MARKET_SIGNING_KEY` GitHub secret as base64 if you want CI signing)
 * - public key  -> `keys/market-public.pem` (committed; the app pins it)
 *
 * Usage: bun scripts/generate-keys.mjs [--force]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';

const root = process.cwd();
const secretDir = path.join(root, '.secrets');
const privateKeyFile = path.join(secretDir, 'market-signing-key.pem');
const publicKeyFile = path.join(root, 'keys/market-public.pem');
const force = process.argv.includes('--force');

if (!force && (await readFile(privateKeyFile).catch(() => null))) {
  console.error('✗ .secrets/market-signing-key.pem already exists (use --force to rotate)');
  process.exit(1);
}

const { privateKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = createPublicKey(createPrivateKey(privatePem)).export({
  type: 'spki',
  format: 'pem',
});

await mkdir(secretDir, { recursive: true });
await mkdir(path.dirname(publicKeyFile), { recursive: true });
await writeFile(privateKeyFile, privatePem, 'utf8');
await writeFile(publicKeyFile, publicPem, 'utf8');

console.log('✓ keypair generated');
console.log('  private: .secrets/market-signing-key.pem  (never commit)');
console.log('  public:  keys/market-public.pem           (commit this)');
console.log('\nFor CI signing, add a repository secret:');
console.log('  MARKET_SIGNING_KEY = base64 of the private pem');
