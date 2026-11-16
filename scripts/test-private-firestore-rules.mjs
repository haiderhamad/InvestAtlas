/**
 * Acceptance test for ACTUALLY GENERATED per-owner Private Cloud Firestore rules.
 * Only the local Firestore Emulator and synthetic principals may be used.
 * Run via npm run test:rules:private (never against a real Firebase project).
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { renderPrivateFirestoreRules } from './render-private-firestore-rules.mjs';

const PROJECT_ID = 'demo-investatlas-private-rules';
const OWNER = 'private-test-owner';
const OTHER = 'private-test-other';
const NOW = '2026-10-29T00:00:00.000Z';

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error('Private rules acceptance refuses a non-disposable Firebase project.');
}
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost || !/^(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(emulatorHost)) {
  throw new Error('FIRESTORE_EMULATOR_HOST must point at an explicitly started local emulator.');
}
const [host, portText] = emulatorHost.split(':');
const port = Number(portText);
assert.ok(port > 0 && port <= 65535);

const canonical = readFileSync('firestore.rules', 'utf8');
const generated = renderPrivateFirestoreRules(canonical, OWNER);
const expectedBoundary = `return request.auth != null && request.auth.uid == '${OWNER}';`;
assert.ok(generated.includes(expectedBoundary), 'Generated owner restriction must be present.');
assert.equal(generated.replace(expectedBoundary, 'return request.auth != null;'), canonical,
  'Private owner rules must preserve all canonical validation rules.');

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host, port, rules: generated },
});
let checks = 0;
async function allowed(promise, scenario) {
  await assertSucceeds(promise);
  checks++;
  console.log(`PASS ALLOW ${scenario}`);
}
async function denied(promise, scenario) {
  await assertFails(promise);
  checks++;
  console.log(`PASS DENY ${scenario}`);
}

function transaction(userId, id) {
  return {
    userId, id, date: NOW, venue: 'broker-test', type: 'buy', asset: 'AAPL',
    assetClass: 'stock', quote: 'USD', amount: 1, price: 100, total: 100,
    fee: 0, taxType: 'acquisition', source: 'manual', notes: 'synthetic only',
  };
}
function account(userId, id) {
  return {
    userId, id, venue: 'broker-test', label: 'Synthetic account',
    kind: 'Brokerage', portfolioScope: 'portfolio', cashCategory: 'investment_cash',
    cashRoutes: ['stock'], needsPortfolioScopeReview: false, notes: '', createdAt: NOW,
  };
}
function assetRisk(userId) {
  return { userId, symbol: 'AAPL', risk: 'Medium' };
}

try {
  await env.clearFirestore();
  const owner = env.authenticatedContext(OWNER).firestore();
  const other = env.authenticatedContext(OTHER).firestore();
  const anonymous = env.unauthenticatedContext().firestore();

  const cases = [
    ['transactions', `${OWNER}~tx-1`, transaction(OWNER, 'tx-1'), { notes: 'Owner updated' }],
    ['manual-accounts', `${OWNER}~account-1`, account(OWNER, 'account-1'), { label: 'Owner updated' }],
    ['asset-risks', `${OWNER}_AAPL`, assetRisk(OWNER), { risk: 'Low' }],
  ];

  for (const [collectionName, id, data, update] of cases) {
    const refOwner = doc(owner, collectionName, id);
    const refOther = doc(other, collectionName, id);
    const refAnonymous = doc(anonymous, collectionName, id);
    await allowed(setDoc(refOwner, data), `${collectionName}: owner create`);
    await allowed(getDoc(refOwner), `${collectionName}: owner read`);
    await allowed(updateDoc(refOwner, update), `${collectionName}: owner update`);
    await denied(getDoc(refOther), `${collectionName}: other read owner's document`);
    await denied(updateDoc(refOther, update), `${collectionName}: other update owner's document`);
    await denied(deleteDoc(refOther), `${collectionName}: other delete owner's document`);
    await denied(getDoc(refAnonymous), `${collectionName}: anonymous read`);
    const createId = collectionName === 'asset-risks' ? `${OWNER}_AMD` : `${id}-anonymous`;
    const createData = collectionName === 'asset-risks'
      ? { ...data, symbol: 'AMD' } : data;
    await denied(setDoc(doc(anonymous, collectionName, createId), createData),
      `${collectionName}: anonymous create with valid schema and document ID`);
    await denied(setDoc(doc(owner, collectionName, createId), { ...createData, userId: OTHER }),
      `${collectionName}: owner cannot forge userId`);
    await denied(updateDoc(refOwner, { userId: OTHER }),
      `${collectionName}: owner cannot transfer document ownership`);

    let otherData = { ...data, userId: OTHER };
    let otherId = `${OTHER}~other`;
    if (collectionName === 'asset-risks') otherId = `${OTHER}_AAPL`;
    await denied(setDoc(doc(other, collectionName, otherId), otherData),
      `${collectionName}: other cannot create own collection documents`);

    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), collectionName, otherId), otherData);
    });
    await denied(getDoc(doc(other, collectionName, otherId)),
      `${collectionName}: other cannot read even a seeded own document`);
    const foreignOwnerRef = doc(owner, collectionName, otherId);
    const foreignOtherRef = doc(other, collectionName, otherId);
    await denied(getDoc(foreignOwnerRef),
      `${collectionName}: owner cannot read foreign user's document`);
    await denied(updateDoc(foreignOwnerRef, update),
      `${collectionName}: owner cannot change foreign user's document`);
    await denied(deleteDoc(foreignOwnerRef),
      `${collectionName}: owner cannot delete foreign user's document`);
    await denied(updateDoc(foreignOtherRef, update),
      `${collectionName}: other cannot edit seeded own document`);
    await denied(deleteDoc(foreignOtherRef),
      `${collectionName}: other cannot delete seeded own document`);

    await allowed(getDocs(query(collection(owner, collectionName), where('userId', '==', OWNER))),
      `${collectionName}: owner filtered query`);
    await denied(getDocs(collection(owner, collectionName)),
      `${collectionName}: owner unfiltered query`);
    await denied(getDocs(query(collection(other, collectionName), where('userId', '==', OTHER))),
      `${collectionName}: other filtered own query`);
    await denied(getDocs(query(collection(other, collectionName), where('userId', '==', OWNER))),
      `${collectionName}: other filtered owner query`);
    await denied(getDocs(query(collection(anonymous, collectionName), where('userId', '==', OWNER))),
      `${collectionName}: anonymous filtered query`);
    await allowed(deleteDoc(refOwner), `${collectionName}: owner delete`);
  }

  const hiddenOwner = doc(owner, 'user_hidden_assets', OWNER);
  await allowed(setDoc(hiddenOwner, { symbols: ['AAPL'] }), 'hidden assets: owner create');
  await allowed(getDoc(hiddenOwner), 'hidden assets: owner read');
  await allowed(updateDoc(hiddenOwner, { symbols: ['AAPL', 'NVDA'] }), 'hidden assets: owner update');
  await denied(getDoc(doc(other, 'user_hidden_assets', OWNER)), 'hidden assets: other read owner');
  await denied(setDoc(doc(other, 'user_hidden_assets', OTHER), { symbols: ['AAPL'] }),
    'hidden assets: other create own');
  await denied(getDoc(doc(anonymous, 'user_hidden_assets', OWNER)), 'hidden assets: anonymous read');
  await denied(setDoc(doc(owner, 'user_hidden_assets', OTHER), { symbols: ['AAPL'] }),
    'hidden assets: owner cannot write another path');
  await denied(setDoc(hiddenOwner, { symbols: ['AAPL', 'AAPL'] }),
    'hidden assets: duplicate symbols rejected');
  await allowed(deleteDoc(hiddenOwner), 'hidden assets: owner delete');

  // Canonical schema guards must remain active with an authorized owner.
  await denied(setDoc(doc(owner, 'transactions', `${OWNER}~invalid`),
    { ...transaction(OWNER, 'invalid'), notes: 'x'.repeat(4001) }),
    'owner invalid transaction shape');
  await denied(setDoc(doc(owner, 'manual-accounts', `${OWNER}~invalid`),
    { ...account(OWNER, 'invalid'), kind: 'unsupported' }),
    'owner invalid account shape');
  await denied(setDoc(doc(owner, 'asset-risks', `${OWNER}_ADA`),
    { userId: OWNER, symbol: 'ADA', risk: 'Critical' }),
    'owner invalid risk schema');

  // Server-owned vaults, plaintext legacy keys and deletion markers must never
  // be reachable through the browser SDK, including for the authorized owner.
  for (const section of ['aiProviders', 'aiProviderVault', 'financialProviderVault', 'accountDeletion']) {
    const ref = doc(owner, 'users', OWNER, section, 'config');
    await denied(getDoc(ref), `${section}: owner browser read`);
    await denied(setDoc(ref, { userId: OWNER, fixture: 'synthetic' }),
      `${section}: owner browser write`);
    await denied(getDoc(doc(other, 'users', OWNER, section, 'config')),
      `${section}: other browser read`);
  }

  const frozenRef = doc(owner, 'transactions', `${OWNER}~freeze-test`);
  await allowed(setDoc(frozenRef, transaction(OWNER, 'freeze-test')),
    'pre-deletion transaction created');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', OWNER, 'accountDeletion', 'state'),
      { state: 'deleting', startedAt: NOW });
  });
  await denied(updateDoc(frozenRef, { notes: 'not allowed during deletion' }),
    'owner update blocked by deletion marker');
  await denied(setDoc(doc(owner, 'manual-accounts', `${OWNER}~frozen`),
    account(OWNER, 'frozen')), 'owner create blocked by deletion marker');
  await allowed(getDoc(frozenRef), 'owner keeps read access during deletion');

  await denied(getDoc(doc(owner, 'unlisted-collection', 'anything')),
    'unknown collection owner read');
  await denied(setDoc(doc(owner, 'unlisted-collection', 'anything'), { userId: OWNER }),
    'unknown collection owner write');

  console.log(`Generated Private Cloud owner-UID Firestore rules verification passed (${checks} emulator assertions).`);
} finally {
  await env.clearFirestore();
  await env.cleanup();
}
