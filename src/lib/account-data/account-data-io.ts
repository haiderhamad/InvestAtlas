'use client';

import { AI_ANALYSIS_STORAGE_KEY } from '@/lib/ai/analysis-cache';
import {
  APP_PREFERENCES_EVENT,
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  readAppPreferences,
  writeAppPreferences,
} from '@/lib/preferences/app-preferences';
import {
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  MANUAL_TRANSACTIONS_STORAGE_KEY,
  readManualTransactions,
} from '@/lib/transactions/manual-store';
import {
  getAllManualAccounts,
  MANUAL_ACCOUNTS_EVENT,
  MANUAL_ACCOUNTS_STORAGE_KEY,
  readManualAccounts,
  type ManualAccount,
} from '@/lib/accounts/manual-accounts-store';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  HIDDEN_ACCOUNTS_EVENT,
  HIDDEN_ACCOUNTS_STORAGE_KEY,
  setHiddenAccountVenues,
} from '@/lib/accounts/account-visibility-store';
import {
  readTaxProfileSettings,
  TAX_PROFILE_STORAGE_KEY,
  TAX_PROFILE_STORAGE_EVENT,
  writeTaxProfileSettings,
} from '@/lib/tax/tax-profile-store';
import { DEFAULT_TAX_PROFILE_SETTINGS, normalizeTaxProfileSettings } from '@/lib/tax/tax-profile';
import {
  DEFAULT_PURIFICATION_SETTINGS,
  PURIFICATION_STORAGE_KEY,
  PURIFICATION_SETTINGS_EVENT,
  readPurificationSettings,
  writePurificationSettings,
  type PurificationSettings,
} from '@/lib/purification/purification-store';
import {
  DEFAULT_WATCHLISTS,
  readWatchlists,
  WATCHLISTS_STORAGE_KEY,
  WATCHLISTS_STORAGE_EVENT,
  writeWatchlists,
  type Watchlist,
} from '@/lib/watchlists/watchlist-store';
import {
  DEFAULT_BUDGET_STATE,
  BUDGET_STORAGE_KEY,
  BUDGET_STORAGE_EVENT,
  readBudgetState,
  writeBudgetState,
  type BudgetState,
} from '@/lib/budget/budget-store';
import {
  ASSET_ICONS_STORAGE_KEY,
  ASSET_ICONS_EVENT,
  readAssetIcons,
  writeAssetIcons,
} from '@/lib/config/asset-icon-store';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';
import {
  HIDDEN_ASSETS_STORAGE_KEY,
  USER_ASSETS_STORAGE_KEY,
  readHiddenAssets,
  readUserAssets,
  writeHiddenAssets,
  writeUserAssets,
  type LocalUserAsset,
} from '@/lib/config/user-assets-store';
import {
  ASSET_RISK_STORAGE_KEY,
  readAssetRisks,
  writeAssetRisks,
  type RiskCategory,
} from '@/lib/config/asset-risk-store';
import { assertCloudDataReady } from '@/lib/storage/cloud-data-status';
import { getUserScopedDocumentId } from '@/lib/storage/firestore-document-id';
import { decodeManualAccount } from '@/lib/accounts/manual-account-schema';
import { decodeInvestmentTransaction } from '@/lib/transactions/transaction-schema';
import { assertTransactionsHaveRequiredCash } from '@/lib/transactions/cash-balances';
import {
  getActiveBrowserWorkspaceUserId,
  readWorkspaceStorageItem,
  removeWorkspaceStorageItem,
  removeWorkspaceStorageItems,
  writeWorkspaceStorageItem,
  type BrowserWorkspaceScope,
} from '@/lib/storage/workspace-storage';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { normalizePersonalListingIdentity } from '@/lib/config/personal-instrument';

export const ACCOUNT_EXPORT_SCHEMA = 'investatlas-account-export-v1';
export const MAX_ACCOUNT_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_ACCOUNT_IMPORT_ROWS = 1_000;
export const MAX_ACCOUNT_IMPORT_CLOUD_RECORDS = 200;
const MAX_FIRESTORE_IMPORT_OPERATIONS = 450;

const EXPORT_COLUMNS = [
  'schema',
  'exportedAt',
  'recordType',
  'recordId',
  'label',
  'date',
  'amount',
  'currency',
  'payloadJson',
] as const;

const DASHBOARD_EXPERIENCE_STORAGE_KEY = 'investatlas.dashboard-experience';
const SAVINGS_PLAN_STRATEGY_STORAGE_KEY = 'savings_plan_strategy';

type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export type AccountExportRecordType =
  | 'metadata'
  | 'manual-account'
  | 'manual-transaction'
  | 'hidden-accounts'
  | 'tax-profile-settings'
  | 'purification-settings'
  | 'watchlists'
  | 'budget-state'
  | 'asset-icons'
  | 'asset-risks'
  | 'user-assets'
  | 'hidden-assets'
  | 'app-preferences'
  | 'dashboard-experience'
  | 'savings-plan-strategy'
  | 'ai-analysis';

interface AccountExportRow {
  schema: string;
  exportedAt: string;
  recordType: AccountExportRecordType;
  recordId: string;
  label: string;
  date: string;
  amount: string;
  currency: string;
  payloadJson: string;
}

export interface AccountImportConflict {
  type:
    | 'account-venue'
    | 'account-label'
    | 'account-id'
    | 'account-id-venue'
    | 'transaction-id';
  label: string;
  existingId: string;
  incomingId: string;
}

export interface AccountImportSummary {
  accounts: number;
  transactions: number;
  hiddenAccounts: number;
  watchlists: number;
  budgetEntries: number;
  localSettings: number;
}

export interface AccountImportPlan {
  schema: typeof ACCOUNT_EXPORT_SCHEMA;
  exportedAt: string;
  accounts: ManualAccount[];
  transactions: InvestmentTransaction[];
  localRecords: Partial<Record<AccountExportRecordType, unknown>>;
  conflicts: AccountImportConflict[];
  summary: AccountImportSummary;
}

export type AccountImportApplyMode = 'append' | 'replace-conflicts';

export function hasNonReplaceableAccountIdentityConflict(
  conflicts: AccountImportConflict[],
): boolean {
  return conflicts.some((conflict) => (
    conflict.type === 'account-id-venue'
    || (
      conflict.type === 'account-label'
      && conflict.existingId !== conflict.incomingId
      && !conflicts.some((candidate) => (
        candidate.type === 'account-venue'
        && candidate.existingId === conflict.existingId
        && candidate.incomingId === conflict.incomingId
      ))
    )
  ));
}

function readJsonStorage(key: string): unknown {
  if (typeof window === 'undefined') return null;
  const raw = readWorkspaceStorageItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  if (value === null || value === undefined) {
    removeWorkspaceStorageItems([key]);
    return;
  }
  writeWorkspaceStorageItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

function removeUndefinedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedFields);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, removeUndefinedFields(entryValue)]),
    );
  }

  return value;
}

function escapeCsvCell(value: unknown) {
  const rawCell = value === null || value === undefined ? '' : String(value);
  // Spreadsheet applications may execute cells beginning with these
  // characters as formulas. The apostrophe is the standard literal prefix.
  const cell = /^[\t\r ]*[=+\-@]/.test(rawCell) ? `'${rawCell}` : rawCell;
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function makeRow(
  exportedAt: string,
  recordType: AccountExportRecordType,
  recordId: string,
  label: string,
  payload: unknown,
  options: Partial<Pick<AccountExportRow, 'date' | 'amount' | 'currency'>> = {},
): AccountExportRow {
  return {
    schema: ACCOUNT_EXPORT_SCHEMA,
    exportedAt,
    recordType,
    recordId,
    label,
    date: options.date ?? '',
    amount: options.amount ?? '',
    currency: options.currency ?? '',
    payloadJson: JSON.stringify(payload),
  };
}

function rowToCsv(row: AccountExportRow) {
  return EXPORT_COLUMNS.map((column) => escapeCsvCell(row[column])).join(',');
}

async function readExportHiddenAssets(): Promise<string[]> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    return normalizeHiddenAssets(readHiddenAssets());
  }

  const snapshot = await getDoc(doc(db, 'user_hidden_assets', currentUser.uid));
  return snapshot.exists()
    ? normalizeHiddenAssets(snapshot.data().symbols)
    : [];
}

export async function buildAccountExportCsv() {
  if (auth?.currentUser) {
    assertCloudDataReady('transactions');
    assertCloudDataReady('accounts');
    assertCloudDataReady('asset_risks');
  }

  const exportedAt = new Date().toISOString();
  const manualAccounts = getAllManualAccounts();
  const transactions = getAllTransactions().filter((transaction) => transaction.source !== 'demo');
  const appPreferences = readAppPreferences();
  const hiddenAssets = await readExportHiddenAssets();
  const assetRisks = normalizeAssetRisks(readAssetRisks());
  const userAssets = normalizeUserAssets(readUserAssets());

  const rows: AccountExportRow[] = [
    makeRow(exportedAt, 'metadata', 'export', 'InvestAtlas Account Export', {
      schema: ACCOUNT_EXPORT_SCHEMA,
      exportedAt,
      app: 'InvestAtlas',
      profile: appPreferences.accountProfile,
      counts: {
        accounts: manualAccounts.length,
        transactions: transactions.length,
        assetRisks: Object.keys(assetRisks).length,
        userAssets: userAssets.length,
        hiddenAssets: hiddenAssets.length,
      },
      excludedSecrets: ['AI provider API keys', 'Firebase credentials'],
    }),
    ...manualAccounts.map((account) =>
      makeRow(exportedAt, 'manual-account', account.id, account.label, account, {
        date: account.createdAt,
      }),
    ),
    ...transactions.map((transaction) =>
      makeRow(exportedAt, 'manual-transaction', transaction.id, transaction.asset, transaction, {
        date: transaction.date,
        amount: String(transaction.amount),
        currency: transaction.quote,
      }),
    ),
    makeRow(exportedAt, 'hidden-accounts', 'hidden-accounts', 'Hidden Accounts', readJsonStorage(HIDDEN_ACCOUNTS_STORAGE_KEY) ?? []),
    makeRow(exportedAt, 'tax-profile-settings', 'tax-profile-settings', 'Tax Profile', readTaxProfileSettings()),
    makeRow(exportedAt, 'purification-settings', 'purification-settings', 'Purification', readPurificationSettings()),
    makeRow(exportedAt, 'watchlists', 'watchlists', 'Watchlists', readWatchlists()),
    makeRow(exportedAt, 'budget-state', 'budget-state', 'Budget', readBudgetState()),
    makeRow(exportedAt, 'asset-icons', 'asset-icons', 'Asset Icons', readAssetIcons()),
    makeRow(exportedAt, 'asset-risks', 'asset-risks', 'Asset Risks', assetRisks),
    makeRow(exportedAt, 'user-assets', 'user-assets', 'User Assets', userAssets),
    makeRow(exportedAt, 'hidden-assets', 'hidden-assets', 'Hidden Assets', hiddenAssets),
    makeRow(exportedAt, 'app-preferences', 'app-preferences', 'App Preferences', appPreferences),
    makeRow(exportedAt, 'dashboard-experience', 'dashboard-experience', 'Dashboard Experience', readJsonStorage(DASHBOARD_EXPERIENCE_STORAGE_KEY)),
    makeRow(exportedAt, 'savings-plan-strategy', 'savings-plan-strategy', 'Savings Plan Strategy', readJsonStorage(SAVINGS_PLAN_STRATEGY_STORAGE_KEY)),
    makeRow(exportedAt, 'ai-analysis', 'ai-analysis', 'AI Analysis', readJsonStorage(AI_ANALYSIS_STORAGE_KEY)),
  ];

  return [
    EXPORT_COLUMNS.join(','),
    ...rows.map(rowToCsv),
  ].join('\n');
}

export async function downloadAccountExportCsv() {
  const csv = await buildAccountExportCsv();
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `investatlas-account-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (quoted) {
    throw new Error('The account export contains an unterminated CSV field.');
  }

  row.push(cell);
  if (row.length > 1 || row[0]) {
    rows.push(row);
  }

  return rows;
}

function isRecordType(value: string): value is AccountExportRecordType {
  return [
    'metadata',
    'manual-account',
    'manual-transaction',
    'hidden-accounts',
    'tax-profile-settings',
    'purification-settings',
    'watchlists',
    'budget-state',
    'asset-icons',
    'asset-risks',
    'user-assets',
    'hidden-assets',
    'app-preferences',
    'dashboard-experience',
    'savings-plan-strategy',
    'ai-analysis',
  ].includes(value);
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not a valid object.`);
  }
  return value as Record<string, unknown>;
}

function assertSafeJsonValue(
  value: unknown,
  label: string,
  depth = 0,
  seenEntries = { count: 0 },
): void {
  if (depth > 12) {
    throw new Error(`${label} is nested too deeply.`);
  }
  if (
    value === null
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= 20_000)
  ) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 2_000) {
      throw new Error(`${label} contains too many items.`);
    }
    value.forEach((entry) => {
      seenEntries.count += 1;
      if (seenEntries.count > 10_000) {
        throw new Error(`${label} is too complex.`);
      }
      assertSafeJsonValue(entry, label, depth + 1, seenEntries);
    });
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 2_000) {
      throw new Error(`${label} contains too many fields.`);
    }
    entries.forEach(([key, entry]) => {
      if (
        key === '__proto__'
        || key === 'prototype'
        || key === 'constructor'
        || key.length > 256
      ) {
        throw new Error(`${label} contains an unsafe field.`);
      }
      seenEntries.count += 1;
      if (seenEntries.count > 10_000) {
        throw new Error(`${label} is too complex.`);
      }
      assertSafeJsonValue(entry, label, depth + 1, seenEntries);
    });
    return;
  }
  throw new Error(`${label} contains an unsupported value.`);
}

function normalizeStringArray(
  value: unknown,
  label: string,
  maximum: number,
  itemMaximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  const normalized = value.map((entry) => {
    if (
      typeof entry !== 'string'
      || entry.length === 0
      || entry.length > itemMaximum
      || entry !== entry.trim()
    ) {
      throw new Error(`${label} contains an invalid value.`);
    }
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate values.`);
  }
  return normalized;
}

function normalizeHiddenAssets(value: unknown): string[] {
  const normalized = normalizeStringArray(value, 'Hidden assets', 256, 32).map((symbol) => {
    const normalizedSymbol = symbol.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(normalizedSymbol)) {
      throw new Error('Hidden assets contain an invalid symbol.');
    }
    return normalizedSymbol;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Hidden assets contain duplicate symbols.');
  }
  return normalized;
}

function normalizeAssetRisks(value: unknown): Record<string, RiskCategory> {
  const record = assertObject(value, 'Asset risks');
  if (Object.keys(record).length > 256) {
    throw new Error('Asset risks contain too many entries.');
  }
  return Object.fromEntries(
    Object.entries(record).map(([rawSymbol, rawRisk]) => {
      const symbol = rawSymbol.trim().toUpperCase();
      if (
        !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)
        || (rawRisk !== 'High' && rawRisk !== 'Medium' && rawRisk !== 'Low')
      ) {
        throw new Error('Asset risks contain an invalid entry.');
      }
      return [symbol, rawRisk];
    }),
  );
}

function normalizeUserAssets(value: unknown): LocalUserAsset[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error('User assets are invalid.');
  }
  const symbols = new Set<string>();
  return value.map((entry) => {
    const asset = assertObject(entry, 'User asset');
    const allowedKeys = new Set([
      'symbol',
      'name',
      'assetClass',
      'isin',
      'wkn',
      'yahooSymbol',
      'searchAliases',
      'listing',
    ]);
    if (Object.keys(asset).some((key) => !allowedKeys.has(key))) {
      throw new Error('User asset contains unsupported fields.');
    }
    const symbol =
      typeof asset.symbol === 'string'
        ? asset.symbol.trim().toUpperCase()
        : '';
    const name = typeof asset.name === 'string' ? asset.name.trim() : '';
    if (
      typeof asset.symbol !== 'string'
      || !/^[\x20-\x7e]*$/.test(asset.symbol)
      || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)
      || name.length === 0
      || name.length > 256
      || !['crypto', 'stock', 'etf', 'metal'].includes(String(asset.assetClass))
      || symbols.has(symbol)
    ) {
      throw new Error('User asset contains invalid or duplicate data.');
    }
    symbols.add(symbol);

    const optionalIdentifier = (field: unknown, label: string) => {
      if (field === undefined) return undefined;
      if (typeof field !== 'string' || field.trim().length === 0 || field.length > 64) {
        throw new Error(`${label} is invalid.`);
      }
      return field.trim();
    };
    const aliases =
      asset.searchAliases === undefined
        ? undefined
        : normalizeStringArray(asset.searchAliases, 'Search aliases', 32, 64);
    // Imported identities are portable hints, never verified source or Shariah evidence.
    const listing = asset.listing === undefined
      ? undefined : normalizePersonalListingIdentity(asset.listing);
    if (asset.listing !== undefined && (!listing
      || listing.symbol !== symbol || listing.assetClass !== asset.assetClass
      || (asset.yahooSymbol !== undefined
        && String(asset.yahooSymbol).trim().toUpperCase() !== listing.providerSymbol))) {
      throw new Error('User asset listing is invalid or conflicts with its asset.');
    }
    const isin = optionalIdentifier(asset.isin, 'ISIN');
    const wkn = optionalIdentifier(asset.wkn, 'WKN');
    const yahooSymbol = optionalIdentifier(asset.yahooSymbol, 'Yahoo symbol');
    return {
      symbol,
      name,
      assetClass: asset.assetClass as LocalUserAsset['assetClass'],
      ...(isin !== undefined ? { isin } : {}),
      ...(wkn !== undefined ? { wkn } : {}),
      ...(yahooSymbol !== undefined ? { yahooSymbol } : {}),
      ...(aliases !== undefined ? { searchAliases: aliases } : {}),
      ...(listing ? { listing } : {}),
    };
  });
}

function normalizeWatchlists(value: unknown): Watchlist[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('Watchlists are invalid.');
  }
  const ids = new Set<string>();
  return value.map((entry) => {
    const watchlist = assertObject(entry, 'Watchlist');
    const id =
      typeof watchlist.id === 'string' ? watchlist.id.trim() : '';
    const name =
      typeof watchlist.name === 'string' ? watchlist.name.trim() : '';
    if (
      id.length === 0
      || id.length > 128
      || name.length === 0
      || name.length > 160
      || ids.has(id)
    ) {
      throw new Error('Watchlist contains invalid or duplicate data.');
    }
    ids.add(id);
    const symbols = normalizeStringArray(
      watchlist.symbols,
      'Watchlist symbols',
      256,
      32,
    ).map((symbol) => symbol.toUpperCase());
    if (symbols.some((symbol) => !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol))) {
      throw new Error('Watchlist contains an invalid symbol.');
    }
    return { id, name, symbols };
  });
}

function normalizeImportAccount(value: unknown): ManualAccount {
  return decodeManualAccount(value);
}

function normalizeImportTransaction(value: unknown): InvestmentTransaction {
  return decodeInvestmentTransaction(value);
}

function buildConflicts(accounts: ManualAccount[], transactions: InvestmentTransaction[]): AccountImportConflict[] {
  const existingAccounts = getAllManualAccounts();
  const existingTransactions = getAllTransactions().filter((transaction) => transaction.source !== 'demo');
  const existingByVenue = new Map(existingAccounts.map((account) => [account.venue, account]));
  const existingById = new Map(existingAccounts.map((account) => [account.id, account]));
  const existingByLabel = new Map(existingAccounts.map((account) => [account.label.trim().toLowerCase(), account]));
  const existingTransactionIds = new Set(existingTransactions.map((transaction) => transaction.id));
  const conflicts: AccountImportConflict[] = [];

  accounts.forEach((account) => {
    const idMatch = existingById.get(account.id);
    if (idMatch) {
      conflicts.push({
        type:
          idMatch.venue === account.venue
            ? 'account-id'
            : 'account-id-venue',
        label: account.label,
        existingId: idMatch.id,
        incomingId: account.id,
      });
    }

    const venueMatch = existingByVenue.get(account.venue);
    if (venueMatch && venueMatch.id !== account.id) {
      conflicts.push({ type: 'account-venue', label: account.label, existingId: venueMatch.id, incomingId: account.id });
    }

    const labelMatch = existingByLabel.get(account.label.trim().toLowerCase());
    if (labelMatch && labelMatch.id !== account.id) {
      conflicts.push({ type: 'account-label', label: account.label, existingId: labelMatch.id, incomingId: account.id });
    }
  });

  transactions.forEach((transaction) => {
    if (existingTransactionIds.has(transaction.id)) {
      conflicts.push({
        type: 'transaction-id',
        label: `${transaction.asset} ${transaction.date}`,
        existingId: transaction.id,
        incomingId: transaction.id,
      });
    }
  });

  return conflicts;
}

export async function parseAccountExportCsv(file: File): Promise<AccountImportPlan> {
  if (file.size > MAX_ACCOUNT_IMPORT_BYTES) {
    throw new Error('The account export is too large.');
  }

  const text = (await file.text()).replace(/^\uFEFF/, '');
  if (new TextEncoder().encode(text).byteLength > MAX_ACCOUNT_IMPORT_BYTES) {
    throw new Error('The account export is too large.');
  }
  const parsedRows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  if (parsedRows.length === 0 || parsedRows.length > MAX_ACCOUNT_IMPORT_ROWS + 1) {
    throw new Error('The account export contains an invalid number of rows.');
  }
  const header = parsedRows.shift();

  if (
    !header
    || header.length !== EXPORT_COLUMNS.length
    || EXPORT_COLUMNS.some((column, index) => header[index] !== column)
  ) {
    throw new Error('This is not a valid InvestAtlas account export CSV.');
  }

  const accounts: ManualAccount[] = [];
  const transactions: InvestmentTransaction[] = [];
  const localRecords: Partial<Record<AccountExportRecordType, unknown>> = {};
  const recordKeys = new Set<string>();
  const singletonTypes = new Set<AccountExportRecordType>();
  let metadataCount = 0;
  let exportedAt = '';

  parsedRows.forEach((cells, index) => {
    if (cells.length !== EXPORT_COLUMNS.length) {
      throw new Error(`Row ${index + 2} has an invalid number of columns.`);
    }

    const row = EXPORT_COLUMNS.reduce((acc, column, columnIndex) => {
      acc[column] = cells[columnIndex] ?? '';
      return acc;
    }, {} as Record<ExportColumn, string>);

    if (row.schema !== ACCOUNT_EXPORT_SCHEMA) {
      throw new Error(`Row ${index + 2} uses an unsupported export schema.`);
    }
    if (!isRecordType(row.recordType)) {
      throw new Error(`Row ${index + 2} has an unknown record type.`);
    }
    if (
      !row.recordId
      || row.recordId.length > 512
      || row.recordId !== row.recordId.trim()
    ) {
      throw new Error(`Row ${index + 2} has an invalid record ID.`);
    }
    if (
      !row.exportedAt
      || row.exportedAt.length > 64
      || !Number.isFinite(Date.parse(row.exportedAt))
    ) {
      throw new Error(`Row ${index + 2} has an invalid export timestamp.`);
    }
    if (exportedAt && exportedAt !== row.exportedAt) {
      throw new Error(`Row ${index + 2} has an inconsistent export timestamp.`);
    }

    const recordKey = `${row.recordType}:${row.recordId}`;
    if (recordKeys.has(recordKey)) {
      throw new Error(`Row ${index + 2} duplicates an earlier record.`);
    }
    recordKeys.add(recordKey);

    let payload: unknown;
    try {
      payload = row.payloadJson ? JSON.parse(row.payloadJson) : null;
    } catch {
      throw new Error(`Row ${index + 2} contains invalid payload JSON.`);
    }
    assertSafeJsonValue(payload, `Row ${index + 2}`);

    exportedAt = exportedAt || row.exportedAt;

    if (row.recordType === 'manual-account') {
      const account = normalizeImportAccount(payload);
      if (account.id !== row.recordId) {
        throw new Error(`Row ${index + 2} has a mismatched account ID.`);
      }
      accounts.push(account);
    } else if (row.recordType === 'manual-transaction') {
      const transaction = normalizeImportTransaction(payload);
      if (transaction.id !== row.recordId) {
        throw new Error(`Row ${index + 2} has a mismatched transaction ID.`);
      }
      transactions.push(transaction);
    } else if (row.recordType === 'metadata') {
      metadataCount += 1;
      if (metadataCount !== 1) {
        throw new Error('The account export contains duplicate metadata.');
      }
      const metadata = assertObject(payload, 'Export metadata');
      if (
        metadata.schema !== ACCOUNT_EXPORT_SCHEMA
        || metadata.exportedAt !== row.exportedAt
      ) {
        throw new Error('The account export metadata is inconsistent.');
      }
    } else {
      if (singletonTypes.has(row.recordType)) {
        throw new Error(`Row ${index + 2} duplicates a settings record.`);
      }
      singletonTypes.add(row.recordType);
      localRecords[row.recordType] = payload;
    }
  });

  if (metadataCount !== 1) {
    throw new Error('The account export metadata is missing.');
  }
  // Local Personal writes browser storage rather than a Firestore batch.
  // Do not apply the Cloud batch ceiling to its otherwise bounded CSV import.
  if (auth?.currentUser
    && accounts.length + transactions.length > MAX_ACCOUNT_IMPORT_CLOUD_RECORDS) {
    throw new Error('The account export contains too many cloud records.');
  }

  const accountIds = new Set<string>();
  const accountVenues = new Set<string>();
  const accountLabels = new Set<string>();
  accounts.forEach((account) => {
    const normalizedLabel = account.label.toLocaleLowerCase('en');
    if (
      accountIds.has(account.id)
      || accountVenues.has(account.venue)
      || accountLabels.has(normalizedLabel)
    ) {
      throw new Error('The account export contains duplicate account identities.');
    }
    accountIds.add(account.id);
    accountVenues.add(account.venue);
    accountLabels.add(normalizedLabel);
  });

  if (localRecords['hidden-accounts'] !== undefined) {
    localRecords['hidden-accounts'] = normalizeStringArray(
      localRecords['hidden-accounts'],
      'Hidden accounts',
      256,
      160,
    );
  }
  if (localRecords['hidden-assets'] !== undefined) {
    localRecords['hidden-assets'] = normalizeHiddenAssets(localRecords['hidden-assets']);
  }
  if (localRecords['asset-risks'] !== undefined) {
    localRecords['asset-risks'] = normalizeAssetRisks(localRecords['asset-risks']);
  }
  if (localRecords['user-assets'] !== undefined) {
    localRecords['user-assets'] = normalizeUserAssets(localRecords['user-assets']);
  }
  if (localRecords.watchlists !== undefined) {
    localRecords.watchlists = normalizeWatchlists(localRecords.watchlists);
  }

  const budgetState = localRecords['budget-state'] as Partial<BudgetState> | undefined;
  const watchlists = localRecords.watchlists as Watchlist[] | undefined;
  const hiddenAccounts = localRecords['hidden-accounts'] as string[] | undefined;

  return {
    schema: ACCOUNT_EXPORT_SCHEMA,
    exportedAt,
    accounts,
    transactions,
    localRecords,
    conflicts: buildConflicts(accounts, transactions),
    summary: {
      accounts: accounts.length,
      transactions: transactions.length,
      hiddenAccounts: Array.isArray(hiddenAccounts) ? hiddenAccounts.length : 0,
      watchlists: Array.isArray(watchlists) ? watchlists.length : 0,
      budgetEntries: Array.isArray(budgetState?.entries) ? budgetState.entries.length : 0,
      localSettings: Object.keys(localRecords).length,
    },
  };
}

export async function applyAccountImportPlan(plan: AccountImportPlan, mode: AccountImportApplyMode) {
  if (
    plan.schema !== ACCOUNT_EXPORT_SCHEMA
    || !Number.isFinite(Date.parse(plan.exportedAt))
  ) {
    throw new Error('The import plan is invalid.');
  }

  const accounts = plan.accounts.map(decodeManualAccount);
  const transactions = plan.transactions.map(decodeInvestmentTransaction);
  if (auth?.currentUser
    && accounts.length + transactions.length > MAX_ACCOUNT_IMPORT_CLOUD_RECORDS) {
    throw new Error('The import plan contains too many cloud records.');
  }
  Object.entries(plan.localRecords).forEach(([recordType, value]) => {
    if (!isRecordType(recordType)) {
      throw new Error('The import plan contains an unsupported record type.');
    }
    assertSafeJsonValue(value, `Imported ${recordType}`);
  });

  const conflicts = buildConflicts(accounts, transactions);
  if (conflicts.length > 0 && mode === 'append') {
    throw new Error('Resolve the existing data conflicts before importing.');
  }
  if (
    mode === 'replace-conflicts'
    && hasNonReplaceableAccountIdentityConflict(conflicts)
  ) {
    throw new Error(
      'An account ID or label is already associated with a different venue. Correct the account identity before importing.',
    );
  }

  const incomingTransactionIds = new Set(transactions.map((transaction) => transaction.id));
  const existingTransactions = getAllTransactions().filter(
    (transaction) =>
      transaction.source !== 'demo'
      && !incomingTransactionIds.has(transaction.id),
  );
  assertTransactionsHaveRequiredCash(existingTransactions, transactions);

  if (auth?.currentUser) {
    // Apply browser-only settings first and retain their snapshot until the
    // canonical Firestore batch succeeds. This validates every local record
    // before cloud mutation and restores the browser workspace if Firestore
    // rejects or aborts the import.
    const rollbackLocalImport = applyLocalImportRecordsWithRollback(
      plan.localRecords,
      true,
    );
    try {
      await applyCloudImport(
        { ...plan, accounts, transactions, conflicts },
        mode,
      );
    } catch (error) {
      rollbackLocalImport();
      throw error;
    }
  } else {
    applyAnonymousImportWithRollback(
      { ...plan, accounts, transactions, conflicts },
      mode,
    );
  }
}

function mapLogicalDocumentIds(
  snapshot: { docs: Array<{ id: string; data: () => unknown }> },
): Map<string, string> {
  const mapping = new Map<string, string>();
  snapshot.docs.forEach((snapshotDocument) => {
    const data = snapshotDocument.data();
    const logicalId =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).id
        : undefined;
    if (typeof logicalId === 'string' && !mapping.has(logicalId)) {
      mapping.set(logicalId, snapshotDocument.id);
    }
  });
  return mapping;
}

async function applyCloudImport(
  plan: AccountImportPlan,
  mode: AccountImportApplyMode,
): Promise<void> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error('Authentication changed before the import was saved.');
  }
  assertCloudDataReady('transactions');
  assertCloudDataReady('accounts');
  assertCloudDataReady('asset_risks');

  const userId = currentUser.uid;
  const [accountSnapshot, transactionSnapshot] = await Promise.all([
    getDocs(query(collection(db, 'manual-accounts'), where('userId', '==', userId))),
    getDocs(query(collection(db, 'transactions'), where('userId', '==', userId))),
  ]);
  if (auth?.currentUser?.uid !== userId) {
    throw new Error('Authentication changed before the import was saved.');
  }

  const accountDocumentIds = mapLogicalDocumentIds(accountSnapshot);
  const transactionDocumentIds = mapLogicalDocumentIds(transactionSnapshot);
  const accountIdsToDelete =
    mode === 'replace-conflicts'
      ? [
          ...new Set(
            plan.conflicts
              .filter(
                (conflict) =>
                  conflict.type === 'account-venue'
                  && conflict.existingId !== conflict.incomingId,
              )
              .map((conflict) => conflict.existingId),
          ),
        ]
      : [];

  const assetRisks =
    plan.localRecords['asset-risks'] === undefined
      ? null
      : normalizeAssetRisks(plan.localRecords['asset-risks']);
  const hiddenAssets =
    plan.localRecords['hidden-assets'] === undefined
      ? null
      : normalizeHiddenAssets(plan.localRecords['hidden-assets']);
  const operationCount =
    plan.accounts.length
    + plan.transactions.length
    + accountIdsToDelete.length
    + (assetRisks ? Object.keys(assetRisks).length : 0)
    + (hiddenAssets ? 1 : 0);
  if (operationCount > MAX_FIRESTORE_IMPORT_OPERATIONS) {
    throw new Error('The import requires too many atomic cloud operations.');
  }

  const batch = writeBatch(db);
  accountIdsToDelete.forEach((logicalId) => {
    const documentId = accountDocumentIds.get(logicalId);
    if (documentId) {
      batch.delete(doc(db, 'manual-accounts', documentId));
    }
  });
  plan.accounts.forEach((account) => {
    const documentId =
      accountDocumentIds.get(account.id)
      ?? getUserScopedDocumentId(userId, account.id);
    batch.set(doc(db, 'manual-accounts', documentId), {
      ...(removeUndefinedFields(account) as Record<string, unknown>),
      userId,
    });
  });
  plan.transactions.forEach((transaction) => {
    const documentId =
      transactionDocumentIds.get(transaction.id)
      ?? getUserScopedDocumentId(userId, transaction.id);
    batch.set(doc(db, 'transactions', documentId), {
      ...(removeUndefinedFields(transaction) as Record<string, unknown>),
      userId,
    });
  });
  Object.entries(assetRisks ?? {}).forEach(([symbol, risk]) => {
    batch.set(doc(db, 'asset-risks', `${userId}_${symbol}`), {
      userId,
      symbol,
      risk,
    });
  });
  if (hiddenAssets) {
    batch.set(doc(db, 'user_hidden_assets', userId), {
      symbols: hiddenAssets,
    });
  }

  await batch.commit();
}

const LOCAL_IMPORT_STORAGE_KEYS = [
  MANUAL_TRANSACTIONS_STORAGE_KEY,
  MANUAL_ACCOUNTS_STORAGE_KEY,
  HIDDEN_ACCOUNTS_STORAGE_KEY,
  TAX_PROFILE_STORAGE_KEY,
  PURIFICATION_STORAGE_KEY,
  WATCHLISTS_STORAGE_KEY,
  BUDGET_STORAGE_KEY,
  ASSET_ICONS_STORAGE_KEY,
  ASSET_RISK_STORAGE_KEY,
  USER_ASSETS_STORAGE_KEY,
  HIDDEN_ASSETS_STORAGE_KEY,
  APP_PREFERENCES_KEY,
  DASHBOARD_EXPERIENCE_STORAGE_KEY,
  SAVINGS_PLAN_STRATEGY_STORAGE_KEY,
  AI_ANALYSIS_STORAGE_KEY,
] as const;

function restoreWorkspaceStorage(
  previous: Map<string, string | null>,
): void {
  previous.forEach((value, key) => {
    if (value === null) {
      removeWorkspaceStorageItem(key);
    } else {
      writeWorkspaceStorageItem(key, value);
    }
  });
  window.dispatchEvent(new Event('storage'));
}

function snapshotWorkspaceStorage(): Map<string, string | null> {
  return new Map(
    LOCAL_IMPORT_STORAGE_KEYS.map((key) => [
      key,
      readWorkspaceStorageItem(key),
    ]),
  );
}

function requireWorkspaceWrite(key: string, value: unknown): void {
  if (!writeWorkspaceStorageItem(key, JSON.stringify(value))) {
    throw new Error('The active browser workspace is not ready.');
  }
}

function applyAnonymousImportWithRollback(
  plan: AccountImportPlan,
  mode: AccountImportApplyMode,
): void {
  const incomingIds = new Set(plan.accounts.map((account) => account.id));
  const incomingVenues = new Set(plan.accounts.map((account) => account.venue));
  const incomingLabels = new Set(plan.accounts.map((account) => account.label.trim().toLowerCase()));
  const nextAccounts = [
    ...plan.accounts,
    ...readManualAccounts().filter(
      (account) =>
        !incomingIds.has(account.id) &&
        !incomingVenues.has(account.venue) &&
        !incomingLabels.has(account.label.trim().toLowerCase()),
    ),
  ];
  const incomingTransactionIds = new Set(plan.transactions.map((transaction) => transaction.id));
  const nextTransactions = [
    ...plan.transactions,
    ...readManualTransactions().filter(
      (transaction) => !incomingTransactionIds.has(transaction.id),
    ),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

  const previous = snapshotWorkspaceStorage();
  try {
    if (mode === 'append' && plan.conflicts.length > 0) {
      throw new Error('Resolve the existing data conflicts before importing.');
    }
    requireWorkspaceWrite(MANUAL_ACCOUNTS_STORAGE_KEY, nextAccounts);
    requireWorkspaceWrite(MANUAL_TRANSACTIONS_STORAGE_KEY, nextTransactions);
    applyLocalImportRecords(plan.localRecords, false);
    window.dispatchEvent(new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: nextAccounts }));
    window.dispatchEvent(new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: nextTransactions }));
    window.dispatchEvent(new Event('storage'));
  } catch (error) {
    restoreWorkspaceStorage(previous);
    throw error;
  }
}

function normalizeAssetIcons(value: unknown): Record<string, string> {
  const icons = assertObject(value, 'Asset icons');
  if (Object.keys(icons).length > 256) {
    throw new Error('Asset icons contain too many entries.');
  }
  return Object.fromEntries(
    Object.entries(icons).map(([rawSymbol, rawUrl]) => {
      const symbol = rawSymbol.trim().toUpperCase();
      if (
        !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)
        || typeof rawUrl !== 'string'
        || rawUrl.length > 2_048
        || !(
          rawUrl.startsWith('https://')
          || rawUrl.startsWith('/')
          || rawUrl.startsWith('data:image/')
        )
      ) {
        throw new Error('Asset icons contain an invalid entry.');
      }
      return [symbol, rawUrl];
    }),
  );
}

function normalizeBudgetState(value: unknown): BudgetState {
  const budget = assertObject(value, 'Budget state');
  if (
    !Array.isArray(budget.categories)
    || !Array.isArray(budget.entries)
    || !Array.isArray(budget.plannedItems)
    || !Array.isArray(budget.paymentMethods)
    || !Array.isArray(budget.accounts)
    || budget.categories.length > 500
    || budget.entries.length > 2_000
    || budget.plannedItems.length > 1_000
  ) {
    throw new Error('Budget state is invalid or too large.');
  }
  return budget as unknown as BudgetState;
}

function applyLocalImportRecords(
  records: AccountImportPlan['localRecords'],
  authenticatedCloud: boolean,
): void {
  if (records['hidden-accounts'] !== undefined) {
    setHiddenAccountVenues(normalizeStringArray(
      records['hidden-accounts'],
      'Hidden accounts',
      256,
      160,
    ));
  }
  if (records['tax-profile-settings'] !== undefined) {
    writeTaxProfileSettings(normalizeTaxProfileSettings(records['tax-profile-settings']));
  }
  if (records['purification-settings'] !== undefined) {
    writePurificationSettings(
      records['purification-settings'] as PurificationSettings,
    );
  }
  if (records.watchlists !== undefined) {
    writeWatchlists(normalizeWatchlists(records.watchlists));
  }
  if (records['budget-state'] !== undefined) {
    writeBudgetState(normalizeBudgetState(records['budget-state']));
  }
  if (records['asset-icons'] !== undefined) {
    writeAssetIcons(normalizeAssetIcons(records['asset-icons']));
  }
  if (!authenticatedCloud && records['asset-risks'] !== undefined) {
    writeAssetRisks(normalizeAssetRisks(records['asset-risks']));
  }
  if (records['user-assets'] !== undefined) {
    writeUserAssets(normalizeUserAssets(records['user-assets']));
  }
  if (!authenticatedCloud && records['hidden-assets'] !== undefined) {
    writeHiddenAssets(normalizeHiddenAssets(records['hidden-assets']));
  }
  if (records['app-preferences'] !== undefined) {
    const imported = assertObject(records['app-preferences'], 'App preferences');
    const currentProfile = readAppPreferences().accountProfile;
    writeAppPreferences({
      theme:
        imported.theme === 'dark'
        || imported.theme === 'light'
        || imported.theme === 'system'
          ? imported.theme
          : DEFAULT_APP_PREFERENCES.theme,
      language:
        imported.language === 'en'
        || imported.language === 'de'
        || imported.language === 'ar'
          ? imported.language
          : DEFAULT_APP_PREFERENCES.language,
      displayCurrency: imported.displayCurrency === 'usd' ? 'usd' : 'eur',
      accountProfile: currentProfile,
    });
  }
  if ('dashboard-experience' in records) {
    writeJsonStorage(DASHBOARD_EXPERIENCE_STORAGE_KEY, records['dashboard-experience']);
  }
  if ('savings-plan-strategy' in records) {
    writeJsonStorage(SAVINGS_PLAN_STRATEGY_STORAGE_KEY, records['savings-plan-strategy']);
  }
  // AI interpretations are derived provider output and are not restored from
  // portable imports. This keeps legacy or tampered action language outside
  // the v2 analysis trust boundary.
}

function applyLocalImportRecordsWithRollback(
  records: AccountImportPlan['localRecords'],
  authenticatedCloud: boolean,
): () => void {
  const previous = snapshotWorkspaceStorage();
  try {
    applyLocalImportRecords(records, authenticatedCloud);
    window.dispatchEvent(new Event('storage'));
  } catch (error) {
    restoreWorkspaceStorage(previous);
    throw error;
  }
  return () => restoreWorkspaceStorage(previous);
}

export async function clearAllAccountData(options: {
  includeCloudStores?: boolean;
  workspaceUserId?: string;
} = {}) {
  const includeCloudStores = options.includeCloudStores ?? true;
  const deletionScope: BrowserWorkspaceScope | undefined =
    options.workspaceUserId === undefined
      ? undefined
      : { userId: options.workspaceUserId };

  if (includeCloudStores) {
    throw new Error('Cloud data deletion requires the authenticated server workflow.');
  }
  if (
    options.workspaceUserId === undefined
    && getActiveBrowserWorkspaceUserId() === null
    && readAnonymousWorkspaceMode() === 'demo_snapshot'
  ) {
    // Demo and Local Workspace deliberately share neither active data nor a
    // deletion lifecycle. Deleting from the read-only demo must never erase
    // dormant Local Workspace records that happen to exist in this browser.
    throw new Error('The read-only Demo Snapshot has no account data to delete.');
  }
  if (typeof window !== 'undefined') {
    removeWorkspaceStorageItems(
      [MANUAL_TRANSACTIONS_STORAGE_KEY, MANUAL_ACCOUNTS_STORAGE_KEY],
      deletionScope,
    );
    window.dispatchEvent(new CustomEvent(MANUAL_TRANSACTIONS_EVENT, { detail: getAllTransactions() }));
    window.dispatchEvent(new CustomEvent(MANUAL_ACCOUNTS_EVENT, { detail: getAllManualAccounts() }));
  }

  if (typeof window !== 'undefined') {
    removeWorkspaceStorageItems([
      HIDDEN_ACCOUNTS_STORAGE_KEY,
      TAX_PROFILE_STORAGE_KEY,
      PURIFICATION_STORAGE_KEY,
      WATCHLISTS_STORAGE_KEY,
      BUDGET_STORAGE_KEY,
      ASSET_ICONS_STORAGE_KEY,
      ASSET_RISK_STORAGE_KEY,
      USER_ASSETS_STORAGE_KEY,
      HIDDEN_ASSETS_STORAGE_KEY,
      APP_PREFERENCES_KEY,
      DASHBOARD_EXPERIENCE_STORAGE_KEY,
      SAVINGS_PLAN_STRATEGY_STORAGE_KEY,
      AI_ANALYSIS_STORAGE_KEY,
    ], deletionScope);

    window.dispatchEvent(new CustomEvent(HIDDEN_ACCOUNTS_EVENT, { detail: [] }));
    window.dispatchEvent(new CustomEvent(TAX_PROFILE_STORAGE_EVENT, { detail: DEFAULT_TAX_PROFILE_SETTINGS }));
    window.dispatchEvent(new CustomEvent(PURIFICATION_SETTINGS_EVENT, { detail: DEFAULT_PURIFICATION_SETTINGS }));
    window.dispatchEvent(new CustomEvent(WATCHLISTS_STORAGE_EVENT, { detail: DEFAULT_WATCHLISTS }));
    window.dispatchEvent(new CustomEvent(BUDGET_STORAGE_EVENT, { detail: DEFAULT_BUDGET_STATE }));
    window.dispatchEvent(new Event(ASSET_ICONS_EVENT));
    window.dispatchEvent(new CustomEvent(APP_PREFERENCES_EVENT, { detail: DEFAULT_APP_PREFERENCES }));
    window.dispatchEvent(new Event('storage'));
  }
}
