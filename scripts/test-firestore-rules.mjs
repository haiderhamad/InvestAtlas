import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'demo-investatlas-rules';
const [firestoreHost, firestorePortText] = (
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
).split(':');
const firestorePort = Number(firestorePortText);

const testEnvironment = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: firestoreHost,
    port: firestorePort,
    rules: fs.readFileSync('firestore.rules', 'utf8'),
  },
});

const ISO_DATE = '2026-07-26T00:00:00.000Z';

function transactionData(overrides = {}) {
  return {
    userId: 'owner-user',
    id: 'transaction-1',
    date: ISO_DATE,
    venue: 'manual-broker',
    settlementVenue: 'manual-bank',
    type: 'buy',
    asset: 'NVDA',
    assetName: 'NVIDIA',
    assetClass: 'stock',
    quote: 'USD',
    amount: 2,
    price: 100,
    total: 200,
    fee: 1,
    taxAmount: 0,
    taxType: 'acquisition',
    source: 'manual',
    notes: '',
    updatedAt: ISO_DATE,
    feeMode: 'flat',
    ...overrides,
  };
}

function metalTransactionData(overrides = {}) {
  return transactionData({
    id: 'metal-transaction-1',
    asset: 'GOLD',
    assetName: 'Gold',
    assetClass: 'metal',
    metalFineness: 750,
    ...overrides,
  });
}

function accountData(overrides = {}) {
  return {
    userId: 'owner-user',
    id: 'manual-account-1',
    venue: 'manual-broker',
    label: 'Manual Broker',
    kind: 'Brokerage',
    portfolioScope: 'portfolio',
    cashCategory: 'investment_cash',
    cashRoutes: ['stock', 'etf', 'crypto', 'metal'],
    needsPortfolioScopeReview: false,
    notes: '',
    createdAt: ISO_DATE,
    ...overrides,
  };
}

function riskData(overrides = {}) {
  return {
    userId: 'owner-user',
    symbol: 'BTC',
    risk: 'High',
    ...overrides,
  };
}

function withoutKey(value, key) {
  const next = { ...value };
  delete next[key];
  return next;
}

async function seedLegacyDocument(collectionName, id, data) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), collectionName, id), data);
  });
}

async function verifyOwnedCollection({
  collectionName,
  id,
  validData,
  validUpdate,
  invalidWrites,
  legacyWriteSucceeds = true,
  ownerDb,
  strangerDb,
  anonymousDb,
}) {
  const ownerRef = doc(ownerDb, collectionName, id);
  const strangerRef = doc(strangerDb, collectionName, id);
  const anonymousRef = doc(anonymousDb, collectionName, id);

  await assertSucceeds(setDoc(ownerRef, validData));
  await assertSucceeds(getDoc(ownerRef));
  await assertSucceeds(updateDoc(ownerRef, validUpdate));
  await assertFails(getDoc(strangerRef));
  await assertFails(updateDoc(strangerRef, validUpdate));
  await assertFails(deleteDoc(strangerRef));
  await assertFails(updateDoc(ownerRef, { userId: 'stranger-user' }));
  await assertFails(getDoc(anonymousRef));
  await assertFails(setDoc(anonymousRef, validData));
  await assertFails(
    setDoc(
      doc(ownerDb, collectionName, `${id}-wrong-owner`),
      { ...validData, userId: 'stranger-user' },
    ),
  );

  for (const [suffix, invalidData, customId] of invalidWrites) {
    await assertFails(
      setDoc(
        doc(ownerDb, collectionName, customId ?? `${id}-${suffix}`),
        invalidData,
      ),
    );
  }

  const legacyId = `${id}-legacy`;
  await seedLegacyDocument(collectionName, legacyId, {
    userId: 'owner-user',
    legacyValue: true,
  });
  const legacyOwnerRef = doc(ownerDb, collectionName, legacyId);
  await assertSucceeds(getDoc(legacyOwnerRef));
  await assertFails(getDoc(doc(strangerDb, collectionName, legacyId)));
  if (legacyWriteSucceeds) {
    await assertSucceeds(setDoc(legacyOwnerRef, validData));
  } else {
    await assertFails(setDoc(legacyOwnerRef, validData));
  }

  await assertSucceeds(
    getDocs(
      query(
        collection(ownerDb, collectionName),
        where('userId', '==', 'owner-user'),
      ),
    ),
  );
  await assertFails(getDocs(collection(ownerDb, collectionName)));
  await assertFails(
    getDocs(
      query(
        collection(strangerDb, collectionName),
        where('userId', '==', 'owner-user'),
      ),
    ),
  );
  await assertSucceeds(
    getDocs(
      query(
        collection(strangerDb, collectionName),
        where('userId', '==', 'stranger-user'),
      ),
    ),
  );
  await assertFails(
    getDocs(
      query(
        collection(anonymousDb, collectionName),
        where('userId', '==', 'owner-user'),
      ),
    ),
  );

  await assertSucceeds(deleteDoc(legacyOwnerRef));
  await assertSucceeds(deleteDoc(ownerRef));
}

try {
  await testEnvironment.clearFirestore();

  const ownerDb = testEnvironment
    .authenticatedContext('owner-user')
    .firestore();
  const strangerDb = testEnvironment
    .authenticatedContext('stranger-user')
    .firestore();
  const anonymousDb = testEnvironment.unauthenticatedContext().firestore();

  const validTransaction = transactionData();
  const validAccount = accountData();
  const validRisk = riskData();

  const ownedCollectionCases = [
    {
      collectionName: 'transactions',
      id: 'owner-user~transaction-1',
      validData: validTransaction,
      validUpdate: { notes: 'Updated by owner' },
      invalidWrites: [
        ['missing-source', withoutKey(validTransaction, 'source')],
        ['unknown-field', { ...validTransaction, debug: true }],
        ['invalid-type', { ...validTransaction, type: 'purchase' }],
        ['invalid-tax-pair', { ...validTransaction, taxType: 'cash_in' }],
        ['invalid-number-type', { ...validTransaction, amount: '2' }],
        ['invalid-number-bound', { ...validTransaction, fee: -1 }],
        ['invalid-symbol', { ...validTransaction, asset: 'NVDA/USD' }],
        ['oversized-notes', { ...validTransaction, notes: 'x'.repeat(4001) }],
        ['metal-fineness-on-stock', { ...validTransaction, metalFineness: 750 }],
        ['partial-fx', { ...validTransaction, fxRateToEur: 0.91 }],
        [
          'invalid-fx-source',
          {
            ...validTransaction,
            fxRateToEur: 0.91,
            fxRateSource: 'unknown',
            fxRateDate: '2026-07-26',
          },
        ],
        [
          'invalid-fx-date',
          {
            ...validTransaction,
            fxRateToEur: 0.91,
            fxRateSource: 'market_provider',
            fxRateDate: '26-07-2026',
          },
        ],
        [
          'fx-on-eur',
          {
            ...validTransaction,
            quote: 'EUR',
            fxRateToEur: 0.91,
            fxRateSource: 'market_provider',
            fxRateDate: '2026-07-26',
          },
        ],
      ],
    },
    {
      collectionName: 'transactions',
      id: 'owner-user~metal-transaction-1',
      validData: metalTransactionData(),
      validUpdate: { notes: 'Updated metal holding by owner' },
      invalidWrites: [
        [
          'missing-metal-fineness',
          withoutKey(metalTransactionData(), 'metalFineness'),
        ],
        ['zero-metal-fineness', metalTransactionData({ metalFineness: 0 })],
        [
          'oversized-metal-fineness',
          metalTransactionData({ metalFineness: 1000.1 }),
        ],
        [
          'string-metal-fineness',
          metalTransactionData({ metalFineness: '750' }),
        ],
      ],
    },
    {
      collectionName: 'manual-accounts',
      id: 'owner-user~manual-account-1',
      validData: validAccount,
      validUpdate: { label: 'Updated Broker' },
      invalidWrites: [
        [
          'missing-normalized-field',
          withoutKey(validAccount, 'portfolioScope'),
        ],
        ['unknown-field', { ...validAccount, debug: true }],
        ['invalid-kind', { ...validAccount, kind: 'Broker' }],
        [
          'legacy-cash-category',
          { ...validAccount, cashCategory: 'private_cash' },
        ],
        ['invalid-routes', { ...validAccount, cashRoutes: ['stock', 'bond'] }],
        [
          'duplicate-routes',
          { ...validAccount, cashRoutes: ['stock', 'stock'] },
        ],
        ['invalid-boolean', { ...validAccount, needsPortfolioScopeReview: 0 }],
        ['oversized-label', { ...validAccount, label: 'x'.repeat(161) }],
      ],
    },
    {
      collectionName: 'asset-risks',
      id: 'owner-user_BTC',
      validData: validRisk,
      validUpdate: { risk: 'Medium' },
      // Risk writes are intentionally forced onto the current UID+symbol ID.
      // The old document remains owner-readable and owner-deletable.
      legacyWriteSucceeds: false,
      invalidWrites: [
        [
          'missing-risk',
          withoutKey(riskData({ symbol: 'ETH' }), 'risk'),
          'owner-user_ETH',
        ],
        [
          'unknown-field',
          { ...riskData({ symbol: 'SOL' }), debug: true },
          'owner-user_SOL',
        ],
        [
          'invalid-risk',
          riskData({ symbol: 'ADA', risk: 'Critical' }),
          'owner-user_ADA',
        ],
        [
          'invalid-symbol',
          riskData({ symbol: 'btc' }),
          'owner-user_btc',
        ],
        [
          'mismatched-document-id',
          riskData({ symbol: 'DOT' }),
          'owner-user_wrong',
        ],
      ],
    },
  ];

  for (const collectionCase of ownedCollectionCases) {
    await verifyOwnedCollection({
      ...collectionCase,
      ownerDb,
      strangerDb,
      anonymousDb,
    });
  }

  const explicitFxRef = doc(
    ownerDb,
    'transactions',
    'owner-user~explicit-fx-transaction',
  );
  await assertSucceeds(
    setDoc(explicitFxRef, transactionData({
      id: 'explicit-fx-transaction',
      fxRateToEur: 0.91,
      fxRateSource: 'broker_statement',
      fxRateDate: '2026-07-26',
    })),
  );
  await assertSucceeds(deleteDoc(explicitFxRef));

  const hiddenOwnerRef = doc(
    ownerDb,
    'user_hidden_assets',
    'owner-user',
  );
  const hiddenStrangerRef = doc(
    strangerDb,
    'user_hidden_assets',
    'owner-user',
  );
  const hiddenAnonymousRef = doc(
    anonymousDb,
    'user_hidden_assets',
    'owner-user',
  );
  await assertSucceeds(setDoc(hiddenOwnerRef, { symbols: ['BTC', 'NVDA'] }));
  await assertSucceeds(getDoc(hiddenOwnerRef));
  await assertSucceeds(updateDoc(hiddenOwnerRef, { symbols: ['BTC'] }));
  await assertFails(getDoc(hiddenStrangerRef));
  await assertFails(setDoc(hiddenStrangerRef, { symbols: ['BTC'] }));
  await assertFails(getDoc(hiddenAnonymousRef));
  await assertFails(setDoc(hiddenAnonymousRef, { symbols: ['BTC'] }));
  await assertFails(
    setDoc(
      doc(ownerDb, 'user_hidden_assets', 'stranger-user'),
      { symbols: ['BTC'] },
    ),
  );
  await assertFails(
    setDoc(hiddenOwnerRef, { symbols: ['BTC'], debug: true }),
  );
  await assertFails(setDoc(hiddenOwnerRef, { symbols: ['BTC', 'BTC'] }));
  await assertFails(setDoc(hiddenOwnerRef, { symbols: ['BTC/USD'] }));
  await assertFails(setDoc(hiddenOwnerRef, { symbols: [123] }));
  await assertFails(
    setDoc(
      hiddenOwnerRef,
      {
        symbols: Array.from(
          { length: 257 },
          (_, index) => `ASSET${index}`,
        ),
      },
    ),
  );
  await assertSucceeds(deleteDoc(hiddenOwnerRef));

  await seedLegacyDocument('user_hidden_assets', 'owner-user', {
    hidden: ['BTC'],
  });
  await assertSucceeds(getDoc(hiddenOwnerRef));
  await assertFails(getDoc(hiddenStrangerRef));
  await assertSucceeds(setDoc(hiddenOwnerRef, { symbols: ['BTC'] }));
  await assertSucceeds(deleteDoc(hiddenOwnerRef));

  const markerOwnerRef = doc(
    ownerDb,
    'users',
    'owner-user',
    'accountDeletion',
    'state',
  );
  const markerWriteTestRef = doc(
    ownerDb,
    'transactions',
    'owner-user~marker-write-test',
  );
  await assertSucceeds(
    setDoc(markerWriteTestRef, {
      ...validTransaction,
      id: 'marker-write-test',
    }),
  );
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(
        context.firestore(),
        'users',
        'owner-user',
        'accountDeletion',
        'state',
      ),
      {
        state: 'deleting',
        startedAt: ISO_DATE,
      },
    );
  });
  await assertFails(getDoc(markerOwnerRef));
  await assertFails(
    setDoc(markerOwnerRef, {
      state: 'deleting',
      startedAt: ISO_DATE,
    }),
  );
  await assertSucceeds(getDoc(markerWriteTestRef));
  await assertFails(
    updateDoc(markerWriteTestRef, { notes: 'Blocked during deletion' }),
  );
  await assertFails(
    setDoc(
      doc(ownerDb, 'transactions', 'owner-user~blocked-transaction'),
      { ...validTransaction, id: 'blocked-transaction' },
    ),
  );
  await assertFails(
    setDoc(
      doc(ownerDb, 'manual-accounts', 'owner-user~blocked-account'),
      { ...validAccount, id: 'blocked-account' },
    ),
  );
  await assertFails(
    setDoc(
      doc(ownerDb, 'asset-risks', 'owner-user_ETH'),
      riskData({ symbol: 'ETH' }),
    ),
  );
  await assertFails(
    setDoc(hiddenOwnerRef, { symbols: ['BTC'] }),
  );
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(
      doc(
        context.firestore(),
        'users',
        'owner-user',
        'accountDeletion',
        'state',
      ),
    );
  });
  await assertSucceeds(
    updateDoc(markerWriteTestRef, { notes: 'Allowed after retry cleanup' }),
  );
  await assertSucceeds(deleteDoc(markerWriteTestRef));

  const legacyProviderRef = doc(
    ownerDb,
    'users',
    'owner-user',
    'aiProviders',
    'legacy',
  );
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(
        context.firestore(),
        'users',
        'owner-user',
        'aiProviders',
        'legacy',
      ),
      {
        userId: 'owner-user',
        apiKey: 'legacy-test-key',
      },
    );
  });
  await assertFails(getDoc(legacyProviderRef));
  await assertFails(
    getDocs(
      collection(
        ownerDb,
        'users',
        'owner-user',
        'aiProviders',
      ),
    ),
  );
  await assertFails(
    setDoc(legacyProviderRef, {
      userId: 'owner-user',
      apiKey: 'test-key',
    }),
  );

  const vaultRef = doc(
    ownerDb,
    'users',
    'owner-user',
    'aiProviderVault',
    'config',
  );
  const strangerVaultRef = doc(
    strangerDb,
    'users',
    'owner-user',
    'aiProviderVault',
    'config',
  );
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(
        context.firestore(),
        'users',
        'owner-user',
        'aiProviderVault',
        'config',
      ),
      {
        userId: 'owner-user',
        schemaVersion: 2,
        keyId: 'primary',
        revision: 1,
        ciphertext: 'encrypted-test-payload',
        iv: 'test-iv',
        authTag: 'test-auth-tag',
        updatedAt: new Date(0).toISOString(),
      },
    );
  });
  await assertFails(getDoc(vaultRef));
  await assertFails(
    setDoc(vaultRef, {
      userId: 'owner-user',
      schemaVersion: 2,
      keyId: 'primary',
      revision: 2,
      ciphertext: 'encrypted-test-payload',
      iv: 'test-iv',
      authTag: 'test-auth-tag',
      updatedAt: new Date(0).toISOString(),
    }),
  );
  await assertFails(
    getDocs(
      collection(
        ownerDb,
        'users',
        'owner-user',
        'aiProviderVault',
      ),
    ),
  );
  await assertFails(getDoc(strangerVaultRef));
  await assertFails(updateDoc(vaultRef, { userId: 'stranger-user' }));
  await assertFails(updateDoc(vaultRef, { apiKey: 'plaintext-key' }));
  await assertFails(deleteDoc(vaultRef));

  console.log('Firestore rules verification passed.');
} finally {
  await testEnvironment.clearFirestore();
  await testEnvironment.cleanup();
}
