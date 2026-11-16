#!/usr/bin/env node
/**
 * Renders a per-owner Firebase Rules file without editing the shared rules.
 * Intended exclusively for manually configured Private Cloud installations.
 * Owner UID is not an API credential; never put real tokens in this command.
 */
import { readFileSync } from 'node:fs';

export function renderPrivateFirestoreRules(source, uid) {
  if (typeof uid !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)
    || uid.toLowerCase().includes('placeholder')
    || uid.toLowerCase().includes('replace')) {
    throw new Error('A valid exact Firebase Auth UID is required');
  }
  const boundary = 'return request.auth != null;';
  if (source.split(boundary).length !== 2
    || !source.includes('function signedIn() {')) {
    throw new Error('Source ownership predicate changed: abort private rules generation');
  }
  return source.replace(boundary,
    `return request.auth != null && request.auth.uid == '${uid}';`);
}

if (process.argv[1]?.endsWith('render-private-firestore-rules.mjs')) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Usage: node scripts/render-private-firestore-rules.mjs FIREBASE_OWNER_UID');
    }
    const source = readFileSync('firestore.rules', 'utf8');
    process.stdout.write(renderPrivateFirestoreRules(source, process.argv[2]));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid configuration'}\n`);
    process.exitCode = 1;
  }
}
