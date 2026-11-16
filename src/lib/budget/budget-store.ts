'use client';

import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

export type BudgetEntryType = 'income' | 'expense';
export type BudgetRecurrence =
  | 'once'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'
  | 'custom';
export type BudgetPaymentStatus = 'planned' | 'paid' | 'open' | 'overdue';
export type BudgetPeriod = 'monthly' | 'quarterly' | 'yearly';

export interface BudgetCategory {
  id: string;
  name: string;
  type: BudgetEntryType;
  group?: string;
  parentCategoryId?: string;
  monthlyLimit?: number;
  color: string;
  icon?: string;
  isDefault?: boolean;
  isCustom?: boolean;
  isFixedDefault?: boolean;
}

export interface BudgetEntry {
  id: string;
  type?: BudgetEntryType;
  amount: number;
  currency?: string;
  categoryId?: string;
  planItemId?: string; // Link to the original plan item
  subcategory?: string;
  description?: string;
  date: string;
  startDate?: string;
  endDate?: string;
  recurrence?: BudgetRecurrence;
  customIntervalDays?: number;
  status?: BudgetPaymentStatus;
  paymentMethod?: string;
  account?: string;
  isFixed?: boolean;
  note?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BudgetPlanItem {
  id: string;
  type: BudgetEntryType;
  name: string;
  amount: number;
  recurrence: BudgetRecurrence;
  month: string;
  endMonth?: string;
  categoryId?: string;
  color?: string;
  status?: BudgetPaymentStatus;
  paymentMethod?: string;
  account?: string;
  isFixed?: boolean;
  isPaid?: boolean; // Track if this planned item has been paid
  paidDate?: string; // When it was paid
  note?: string;
}





export interface BudgetProfile {
  monthlyIncome: number;
  monthlyBudget: number;
}

export interface BudgetState {
  categories: BudgetCategory[];
  entries: BudgetEntry[];
  plannedItems: BudgetPlanItem[];
  paymentMethods: string[];
  accounts: string[];
}

export const BUDGET_STORAGE_KEY = 'investatlas.budget-state';
export const BUDGET_STORAGE_EVENT = 'investatlas:budget-state-change';

const DEFAULT_PAYMENT_METHODS = [
  'Cash',
  'Checking account',
  'Credit card',
  'PayPal',
  'Bank transfer',
  'Direct debit',
  'Apple Pay / Google Pay',
  'Other payment method',
];

const DEFAULT_ACCOUNTS = ['Private account', 'Savings account', 'Business account', 'Credit card account', 'Investment account'];

export const DEFAULT_BUDGET_CATEGORIES: BudgetCategory[] = [
  // --- Income ---
  { id: 'income-salary', name: 'Main job / Salary', type: 'income', group: 'Income', color: '#10b981', icon: 'wallet', isDefault: true, isFixedDefault: true },
  { id: 'income-dividends', name: 'Dividends / Capital', type: 'income', group: 'Income', color: '#059669', icon: 'trending-up', isDefault: true },
  { id: 'income-other', name: 'Other income', type: 'income', group: 'Income', color: '#34d399', icon: 'plus-circle', isDefault: true },

  // --- Expenses ---
  { id: 'housing-rent', name: 'Rent', type: 'expense', group: 'Housing', color: '#ef4444', icon: 'home', isDefault: true, isFixedDefault: true },
  { id: 'housing-utilities', name: 'Utilities & Bills', type: 'expense', group: 'Housing', color: '#f87171', icon: 'zap', isDefault: true, isFixedDefault: true },
  { id: 'daily-groceries', name: 'Groceries', type: 'expense', group: 'Food & Daily Life', color: '#dc2626', icon: 'shopping-cart', isDefault: true },
  { id: 'transport-mobility', name: 'Mobility / Transport', type: 'expense', group: 'Transport', color: '#b91c1c', icon: 'car', isDefault: true },
  { id: 'health-care', name: 'Health & Insurance', type: 'expense', group: 'Health', color: '#991b1b', icon: 'heart-pulse', isDefault: true, isFixedDefault: true },
  { id: 'leisure-lifestyle', name: 'Leisure & Lifestyle', type: 'expense', group: 'Leisure', color: '#fca5a5', icon: 'gamepad-2', isDefault: true },
  { id: 'finance-savings', name: 'Savings / Investments', type: 'expense', group: 'Finance', color: '#7f1d1d', icon: 'target', isDefault: true, isFixedDefault: true },
  { id: 'other-expenses', name: 'Other / Miscellaneous', type: 'expense', group: 'Other', color: '#450a0a', icon: 'help-circle', isDefault: true },
];



export const DEFAULT_BUDGET_STATE: BudgetState = {
  categories: DEFAULT_BUDGET_CATEGORIES,
  entries: [],
  plannedItems: [],
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  accounts: DEFAULT_ACCOUNTS,
};

function normalizeRecurrence(value: unknown): BudgetRecurrence {
  return value === 'daily' ||
    value === 'weekly' ||
    value === 'biweekly' ||
    value === 'monthly' ||
    value === 'quarterly' ||
    value === 'semiannual' ||
    value === 'yearly' ||
    value === 'custom'
    ? value
    : 'once';
}

function normalizeStatus(value: unknown): BudgetPaymentStatus {
  return value === 'paid' || value === 'open' || value === 'overdue' || value === 'planned' ? value : 'paid';
}

function migrateLegacyCategories(categories: unknown): BudgetCategory[] {
  // If we have categories in storage and it's a non-empty array, we use it
  if (Array.isArray(categories) && categories.length > 0) {
    // Ensure every category has the minimum required fields
    return (categories as BudgetCategory[]).filter(c => c && c.id && c.name && c.type);
  }
  
  // If no categories or empty list, ALWAYS return the simplified defaults
  return [...DEFAULT_BUDGET_CATEGORIES];
}

function migrateLegacyPlannedItems(categories: BudgetCategory[]): BudgetPlanItem[] {
  const salaryCategory = categories.find((category) => category.id === 'income-salary');
  return [
    {
      id: 'income-main',
      type: 'income',
      name: salaryCategory?.name ?? 'Main job / Salary',
      amount: 4500,
      recurrence: 'monthly',
      month: '2026-01',
      categoryId: salaryCategory?.id,
      color: salaryCategory?.color ?? '#16c784',
      status: 'planned',
    },
  ];
}

export function readBudgetState(): BudgetState {
  if (typeof window === 'undefined') {
    return DEFAULT_BUDGET_STATE;
  }

  try {
    const raw = readWorkspaceStorageItem(BUDGET_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_BUDGET_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<BudgetState>;
    const categories = migrateLegacyCategories(parsed.categories);
    const categoryIds = new Set(categories.map((category) => category.id));
    const firstExpense = categories.find((category) => category.type === 'expense')?.id;
    const firstIncome = categories.find((category) => category.type === 'income')?.id;

    return {
      categories,
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.map((entry) => {
            const type = entry.type === 'income' ? 'income' : 'expense';
            return {
              ...entry,
              type,
              categoryId:
                entry.categoryId && categoryIds.has(entry.categoryId)
                  ? entry.categoryId
                  : type === 'income'
                  ? firstIncome
                  : firstExpense,
              currency: entry.currency ?? 'EUR',
              description: entry.description ?? entry.note,
              startDate: entry.startDate ?? entry.date,
              recurrence: normalizeRecurrence(entry.recurrence),
              status: normalizeStatus(entry.status),
              isFixed: entry.isFixed ?? categories.find((category) => category.id === entry.categoryId)?.isFixedDefault ?? false,
              createdAt: entry.createdAt ?? entry.date,
              updatedAt: entry.updatedAt ?? entry.date,
            };
          })
        : DEFAULT_BUDGET_STATE.entries,
      plannedItems: Array.isArray(parsed.plannedItems)
        ? parsed.plannedItems.map((item) => ({
            ...item,
            type: item.type === 'income' ? 'income' : 'expense',
            recurrence: normalizeRecurrence(item.recurrence),
            status: normalizeStatus(item.status),
          }))
        : migrateLegacyPlannedItems(categories),
      paymentMethods: Array.isArray(parsed.paymentMethods) ? parsed.paymentMethods : DEFAULT_PAYMENT_METHODS,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : DEFAULT_ACCOUNTS,
    };
  } catch {
    return DEFAULT_BUDGET_STATE;
  }
}

export function writeBudgetState(nextState: BudgetState) {
  if (typeof window === 'undefined') {
    return;
  }

  if (writeWorkspaceStorageItem(BUDGET_STORAGE_KEY, JSON.stringify(nextState))) {
    window.dispatchEvent(new CustomEvent(BUDGET_STORAGE_EVENT, { detail: nextState }));
  }
}
