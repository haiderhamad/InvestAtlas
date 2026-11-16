import { 
  type BudgetCategory, 
  type BudgetEntry, 
  type BudgetEntryType, 
  type BudgetPlanItem, 
  type BudgetRecurrence,
  type BudgetPaymentStatus
} from './budget-store';

export interface CategoryRow {
  id: string;
  label: string;
  group?: string;
  color: string;
  planned: number;
  actual: number;
  value: number;
  remaining: number;
  transactionCount: number;
  kind: BudgetEntryType;
  isFixed?: boolean;
}

export interface BudgetOccurrence extends BudgetEntry {
  sourceId: string;
  occurrenceDate: string;
}

export interface TimelinePoint {
  key: string;
  label: string;
  months: string[];
  income: number;
  expense: number;
  balance: number;
}

export const BUDGET_CATEGORY_COLORS = [
  '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
  '#f87171', '#fca5a5', '#450a0a', '#f97316', '#fb923c'
];

export const INCOME_COLORS = ['#10b981', '#059669', '#34d399', '#047857', '#6ee7b7'];

export function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function addMonths(monthKey: string, offset: number) {
  const [yearText, monthText] = monthKey.split('-');
  const totalMonths = Number(yearText) * 12 + Number(monthText) - 1 + offset;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function getMonthDate(monthKey: string) {
  return new Date(`${monthKey}-01T12:00:00.000Z`);
}

export function getMonthBounds(monthKey: string) {
  const start = getMonthDate(monthKey);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59));
  return { start, end };
}

export function normalizeDateOnly(value?: string) {
  return value ? value.slice(0, 10) : '';
}

export function parseDateOnly(value?: string) {
  const normalized = normalizeDateOnly(value);
  return normalized ? new Date(`${normalized}T12:00:00.000Z`) : undefined;
}

export function daysBetween(start: Date, end: Date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / msPerDay);
}

export function monthDiff(start: Date, end: Date) {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

export function getRecurrenceStepMonths(recurrence: BudgetRecurrence) {
  if (recurrence === 'monthly') return 1;
  if (recurrence === 'quarterly') return 3;
  if (recurrence === 'semiannual') return 6;
  if (recurrence === 'yearly') return 12;
  return 0;
}

export function getRecurrenceStepDays(recurrence: BudgetRecurrence, customIntervalDays?: number) {
  if (recurrence === 'daily') return 1;
  if (recurrence === 'weekly') return 7;
  if (recurrence === 'biweekly') return 14;
  if (recurrence === 'custom') return Math.max(1, Number(customIntervalDays) || 30);
  return 0;
}

export function occursInMonth(
  startDate: Date,
  monthKey: string,
  recurrence: BudgetRecurrence,
  endDate?: Date,
  customIntervalDays?: number,
) {
  const { start: monthStart, end: monthEnd } = getMonthBounds(monthKey);
  if (endDate && endDate < monthStart) return 0;
  if (startDate > monthEnd) return 0;

  if (recurrence === 'once') {
    return startDate >= monthStart && startDate <= monthEnd ? 1 : 0;
  }

  const monthlyStep = getRecurrenceStepMonths(recurrence);
  if (monthlyStep > 0) {
    const diff = monthDiff(startDate, monthStart);
    if (diff < 0 || diff % monthlyStep !== 0) return 0;
    const day = Math.min(startDate.getUTCDate(), new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate());
    const occurrence = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 12));
    return occurrence >= monthStart && occurrence <= monthEnd && (!endDate || occurrence <= endDate) ? 1 : 0;
  }

  const dailyStep = getRecurrenceStepDays(recurrence, customIntervalDays);
  if (dailyStep <= 0) return 0;

  let count = 0;
  const firstOffset = Math.max(0, Math.ceil(daysBetween(startDate, monthStart) / dailyStep) * dailyStep);
  for (let offset = firstOffset; ; offset += dailyStep) {
    const occurrence = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate() + offset, 12));
    if (occurrence > monthEnd || (endDate && occurrence > endDate)) break;
    if (occurrence >= monthStart) count += 1;
  }
  return count;
}

export function getQuarterNumber(monthKey: string) {
  return Math.floor((Number(monthKey.slice(5, 7)) - 1) / 3) + 1;
}

export function getQuarterStart(monthKey: string) {
  const year = monthKey.slice(0, 4);
  const quarterStartMonth = (getQuarterNumber(monthKey) - 1) * 3 + 1;
  return `${year}-${String(quarterStartMonth).padStart(2, '0')}`;
}

export function getPeriodMonths(anchorMonth: string, periodView: 'month' | 'quarter' | 'year') {
  if (periodView === 'month') return [anchorMonth];
  if (periodView === 'quarter') {
    const start = getQuarterStart(anchorMonth);
    return [start, addMonths(start, 1), addMonths(start, 2)];
  }
  const year = anchorMonth.slice(0, 4);
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

export function getTimelinePeriods(anchorMonth: string, periodView: 'month' | 'quarter' | 'year', locale: string) {
  if (periodView === 'month') {
    // For single month view, we show 6 months trailing
    return Array.from({ length: 6 }, (_, i) => {
      const monthKey = addMonths(anchorMonth, -5 + i);
      const date = getMonthDate(monthKey);
      return {
        key: monthKey,
        label: date.toLocaleDateString(locale, { month: 'short', year: '2-digit' }),
        months: [monthKey],
        income: 0,
        expense: 0,
        balance: 0,
      };
    });
  }

  const months = getPeriodMonths(anchorMonth, periodView);
  return months.map((monthKey) => {
    const date = getMonthDate(monthKey);
    return {
      key: monthKey,
      label: date.toLocaleDateString(locale, { month: 'short' }),
      months: [monthKey],
      income: 0,
      expense: 0,
      balance: 0,
    };
  });
}


export function isPlanItemActiveInMonth(item: BudgetPlanItem, monthKey: string) {
  return countPlanItemOccurrences(item, monthKey) > 0;
}

export function countPlanItemOccurrences(item: BudgetPlanItem, monthKey: string) {
  return occursInMonth(
    getMonthDate(item.month),
    monthKey,
    item.recurrence,
    item.endMonth ? getMonthDate(item.endMonth) : undefined,
  );
}

export function sumPlanItems(items: BudgetPlanItem[], months: string[], type: BudgetEntryType) {
  // Pre-calculate items by type for faster filtering
  const typedItems = items.filter(item => item.type === type);
  
  return months.reduce(
    (sum, monthKey) =>
      sum +
      typedItems
        .filter((item) => isPlanItemActiveInMonth(item, monthKey))
        .reduce((monthSum, item) => monthSum + item.amount * countPlanItemOccurrences(item, monthKey), 0),
    0,
  );
}

export function getEntryType(entry: BudgetEntry): BudgetEntryType {
  return entry.type === 'income' ? 'income' : 'expense';
}

export function getEntryOccurrences(entries: BudgetEntry[], months: string[]): BudgetOccurrence[] {
  return entries.flatMap((entry) => {
    const recurrence = entry.recurrence ?? 'once';
    const startDate = parseDateOnly(entry.startDate ?? entry.date);
    const endDate = parseDateOnly(entry.endDate);
    if (!startDate) return [];

    return months.flatMap((monthKey) => {
      const count = occursInMonth(startDate, monthKey, recurrence, endDate, entry.customIntervalDays);
      if (count <= 0) return [];

      if (recurrence === 'once') {
        return [{
          ...entry,
          id: `${entry.id}-${normalizeDateOnly(entry.date)}`,
          sourceId: entry.id,
          date: entry.date,
          occurrenceDate: normalizeDateOnly(entry.date),
        }];
      }

      const { start: monthStart } = getMonthBounds(monthKey);
      return Array.from({ length: count }, (_, index) => ({
        ...entry,
        id: `${entry.id}-${monthKey}-${index}`,
        sourceId: entry.id,
        date: monthStart.toISOString(),
        occurrenceDate: monthStart.toISOString().slice(0, 10),
      }));
    });
  });
}

export function buildExpenseRows(
  categories: BudgetCategory[],
  plannedItems: BudgetPlanItem[],
  entries: BudgetEntry[],
  months: string[],
) {
  // Pre-filter planned items and entries once
  const expensePlanned = plannedItems.filter(item => item.type === 'expense');
  const expenseEntries = entries.filter(entry => getEntryType(entry) === 'expense');

  // Group entries by category for O(1) lookup
  const entriesByCategory = new Map<string, BudgetEntry[]>();
  expenseEntries.forEach(entry => {
    const list = entriesByCategory.get(entry.categoryId || '') || [];
    list.push(entry);
    entriesByCategory.set(entry.categoryId || '', list);
  });

  return categories
    .map<CategoryRow>((category, index) => {
      const color = category.color || BUDGET_CATEGORY_COLORS[index % BUDGET_CATEGORY_COLORS.length];
      const planned = months.reduce(
        (sum, monthKey) =>
          sum +
          expensePlanned
            .filter((item) => item.categoryId === category.id && isPlanItemActiveInMonth(item, monthKey))
            .reduce((monthSum, item) => monthSum + item.amount * countPlanItemOccurrences(item, monthKey), 0),
        0,
      );
      
      const matchingEntries = entriesByCategory.get(category.id) || [];
      const actual = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);

      return {
        id: category.id,
        label: category.name,
        group: category.group,
        color,
        planned,
        actual,
        value: actual > 0 ? actual : planned,
        remaining: planned - actual,
        transactionCount: matchingEntries.length,
        kind: 'expense',
        isFixed: category.isFixedDefault || matchingEntries.some((entry) => entry.isFixed),
      };
    })
    .filter((row) => row.planned > 0 || row.actual > 0)
    .sort((first, second) => second.value - first.value);
}

export function buildIncomeRows(categories: BudgetCategory[], plannedItems: BudgetPlanItem[], entries: BudgetEntry[], months: string[]) {
  const incomeCategories = categories.filter((category) => category.type === 'income');
  const incomeEntries = entries.filter(entry => getEntryType(entry) === 'income');
  
  // Group entries by category for O(1) lookup
  const entriesByCategory = new Map<string, BudgetEntry[]>();
  incomeEntries.forEach(entry => {
    const list = entriesByCategory.get(entry.categoryId || '') || [];
    list.push(entry);
    entriesByCategory.set(entry.categoryId || '', list);
  });

  const planRows = plannedItems
    .filter((item) => item.type === 'income')
    .map<CategoryRow>((item, index) => {
      const planned = months.reduce((sum, monthKey) => sum + item.amount * countPlanItemOccurrences(item, monthKey), 0);
      const category = incomeCategories.find((current) => current.id === item.categoryId);
      const matchingEntries = entriesByCategory.get(item.categoryId || '') || [];
      const actual = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);

      return {
        id: item.categoryId ?? item.id,
        label: category?.name ?? item.name,
        group: category?.group,
        color: item.color || category?.color || INCOME_COLORS[index % INCOME_COLORS.length],
        planned,
        actual,
        value: actual > 0 ? actual : planned,
        remaining: planned - actual,
        transactionCount: matchingEntries.length,
        kind: 'income',
      };
    })
    .filter((row) => row.planned > 0 || row.actual > 0);

  const plannedIds = new Set(planRows.map((row) => row.id));
  const actualRows = incomeCategories
    .filter((category) => !plannedIds.has(category.id))
    .map<CategoryRow>((category) => {
      const matchingEntries = entriesByCategory.get(category.id) || [];
      const actual = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);
      return {
        id: category.id,
        label: category.name,
        group: category.group,
        color: category.color,
        planned: 0,
        actual,
        value: actual,
        remaining: actual,
        transactionCount: matchingEntries.length,
        kind: 'income',
      };
    })
    .filter((row) => row.actual > 0);

  return [...planRows, ...actualRows].sort((first, second) => second.value - first.value);
}
