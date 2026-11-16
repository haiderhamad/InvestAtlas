import fs from 'node:fs';
import path from 'node:path';

const rules = fs.readFileSync(
  path.join(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('Firestore ownership rules', () => {
  it('requires the existing and incoming owner to match on mutable owner documents', () => {
    const existingOwnerChecks =
      rules.match(/allow update: if ownsUserId\(\)/g) ?? [];
    const immutableOwnerChecks =
      rules.match(/resource\.data\.userId == request\.resource\.data\.userId/g) ?? [];

    expect(existingOwnerChecks).toHaveLength(3);
    expect(immutableOwnerChecks).toHaveLength(3);
    expect(rules).toContain('writesOwnUserId()');
  });

  it('accepts only normalized full writes for owned application data', () => {
    expect(rules).toContain('validTransaction(request.resource.data)');
    expect(rules).toContain('validManualAccount(request.resource.data)');
    expect(rules).toContain('validAssetRisk(request.resource.data)');
    expect(rules).toContain('validHiddenAssets(request.resource.data)');

    for (const validator of [
      'validTransaction',
      'validManualAccount',
      'validAssetRisk',
      'validHiddenAssets',
    ]) {
      const validationFunction = rules.match(
        new RegExp(`function ${validator}\\(data\\) \\{([\\s\\S]*?)\\n    \\}`),
      )?.[1];

      expect(validationFunction).toContain('data.keys().hasAll');
      expect(validationFunction).toContain('data.keys().hasOnly');
    }
  });

  it('keeps owner reads independent of the new write schema for legacy documents', () => {
    expect(rules).toContain('allow read, delete: if ownsUserId();');
    expect(rules).toContain('allow read, delete: if ownsPath(userId);');
    expect(rules).not.toMatch(
      /allow read[^;]*valid(Transaction|ManualAccount|AssetRisk|HiddenAssets)/,
    );
  });

  it('requires bounded metal fineness and rejects it on non-metal rows', () => {
    const transactionValidator = rules.match(
      /function validTransaction\(data\) \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(transactionValidator).toContain(
      "data.assetClass == 'metal'",
    );
    expect(transactionValidator).toContain(
      "data.keys().hasAll(['metalFineness'])",
    );
    expect(transactionValidator).toContain(
      'validNumber(data.metalFineness, 1, 1000)',
    );
    expect(transactionValidator).toContain(
      "!data.keys().hasAny(['metalFineness'])",
    );
  });

  it('allows only complete bounded transaction FX provenance', () => {
    const transactionValidator = rules.match(
      /function validTransaction\(data\) \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(transactionValidator).toContain("'fxRateToEur'");
    expect(transactionValidator).toContain("'fxRateSource'");
    expect(transactionValidator).toContain("'fxRateDate'");
    expect(transactionValidator).toContain(
      'validNumber(data.fxRateToEur, 0.000000000001, 1000000)',
    );
    expect(transactionValidator).toContain("'broker_statement'");
    expect(transactionValidator).toContain("'market_provider'");
    expect(transactionValidator).toContain("'user_entered'");
    expect(transactionValidator).toContain(
      "'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'",
    );
  });

  it('enforces the current user-scoped asset-risk document ID on creates', () => {
    expect(rules).toContain(
      "riskId == request.auth.uid + '_' + request.resource.data.symbol",
    );
  });

  it('keeps the account-deletion marker server-owned and freezes new writes', () => {
    const markerBlock = rules.match(
      /match \/users\/\{userId\}\/accountDeletion\/\{markerId\} \{([\s\S]*?)\n    \}/,
    )?.[1];
    const deletionGuards =
      rules.match(/accountDeletionNotStarted\(\)/g) ?? [];

    expect(markerBlock).toContain('allow read, write: if false;');
    expect(rules).toContain(
      '/documents/users/$(request.auth.uid)/accountDeletion/state',
    );
    expect(deletionGuards).toHaveLength(8);
  });

  it('blocks the legacy plaintext AI provider collection', () => {
    const legacyBlock = rules.match(
      /match \/users\/\{userId\}\/aiProviders\/\{providerId\} \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(legacyBlock).toContain('allow read, write: if false;');
  });

  it('keeps the encrypted vault completely server-owned', () => {
    const vaultBlock = rules.match(
      /match \/users\/\{userId\}\/aiProviderVault\/\{vaultId\} \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(vaultBlock).toContain('allow read, write: if false;');
  });

  it('keeps the financial credential vault completely server-owned', () => {
    const vaultBlock = rules.match(
      /match \/users\/\{userId\}\/financialProviderVault\/\{vaultId\} \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(vaultBlock).toContain('allow read, write: if false;');
  });

  it('does not retain a browser-writable vault validator', () => {
    expect(rules).not.toContain('validEncryptedProviderVault');
  });
});
