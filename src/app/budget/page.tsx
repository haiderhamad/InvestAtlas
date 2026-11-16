'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/layout/app-shell';
import {
  BUDGET_STORAGE_EVENT,
  DEFAULT_BUDGET_STATE,
  readBudgetState,
  writeBudgetState,
  type BudgetCategory,
  type BudgetEntry,
  type BudgetEntryType,
  type BudgetPlanItem,
  type BudgetRecurrence,
} from '@/lib/budget/budget-store';
import {
  getCurrentMonthKey,
  addMonths,
  getPeriodMonths,
  getTimelinePeriods,
  buildExpenseRows,
  buildIncomeRows,
  sumPlanItems,
  getEntryOccurrences,
  getEntryType,
  BUDGET_CATEGORY_COLORS,
  INCOME_COLORS
} from '@/lib/budget/budget-utils';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Wallet,
  Home,
  ShoppingCart,
  Car,
  Zap,
  HeartPulse,
  Gamepad2,
  Landmark,
  ReceiptText,
  HelpCircle,
  Settings2,
  ListChecks,
  LayoutDashboard,
} from 'lucide-react';

// Components
import { BudgetDashboard } from './components/BudgetDashboard';
import { BudgetRecords } from './components/BudgetRecords';
import { BudgetSettings } from './components/BudgetSettings';

const iconOptions = [
  { name: 'wallet', icon: Wallet },
  { name: 'home', icon: Home },
  { name: 'shopping-cart', icon: ShoppingCart },
  { name: 'car', icon: Car },
  { name: 'zap', icon: Zap },
  { name: 'heart-pulse', icon: HeartPulse },
  { name: 'gamepad-2', icon: Gamepad2 },
  { name: 'trending-up', icon: TrendingUp },
  { name: 'target', icon: Target },
  { name: 'landmark', icon: Landmark },
  { name: 'help-circle', icon: HelpCircle },
  { name: 'receipt-text', icon: ReceiptText },
];

export default function BudgetPage() {
  const { t, language } = useAppTranslation();
  const { formatMoney } = useDisplayCurrencyPreference();
  const locale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const currentMonthKey = getCurrentMonthKey();

  // App State
  const [mounted, setMounted] = useState(false);
  const [budgetState, setBudgetState] = useState(DEFAULT_BUDGET_STATE);
  const [activeTab, setActiveTab] = useState<'overview' | 'records' | 'settings'>('overview');
  const [anchorMonth, setAnchorMonth] = useState(currentMonthKey);
  const [periodView, setPeriodView] = useState<'month' | 'quarter' | 'year'>('month');
  const [selectedTimelineKey, setSelectedTimelineKey] = useState(currentMonthKey);
  const [analysisKind, setAnalysisKind] = useState<'expense' | 'income'>('expense');
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | undefined>();

  // Combined Record Form State
  const [recordType, setRecordType] = useState<BudgetEntryType>('expense');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recordName, setRecordName] = useState('');
  const [recordAmount, setRecordAmount] = useState(0);
  const [recordCategoryId, setRecordCategoryId] = useState('');
  const [recordDate, setRecordDate] = useState(new Date().toISOString().slice(0, 10)); // or month key
  const [recordRecurrence, setRecordRecurrence] = useState<BudgetRecurrence>('monthly');

  // Category Form State
  const [categoryName, setCategoryName] = useState('');
  const [categoryType, setCategoryType] = useState<BudgetEntryType>('expense');
  const [categoryGroup, setCategoryGroup] = useState('Other');
  const [categoryIcon, setCategoryIcon] = useState('help-circle');
  const [categoryIsFixed, setCategoryIsFixed] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // Sync Logic
  useEffect(() => {
    setMounted(true);
    setBudgetState(readBudgetState());
  }, []);

  useEffect(() => {
    const sync = () => setBudgetState(readBudgetState());
    window.addEventListener(BUDGET_STORAGE_EVENT, sync);
    return () => window.removeEventListener(BUDGET_STORAGE_EVENT, sync);
  }, []);

  // Derived Values
  const periodMonths = useMemo(() => getPeriodMonths(anchorMonth, periodView), [anchorMonth, periodView]);
  
  // Pre-calculate monthly sums for the timeline to avoid N*M complexity
  const monthlyDataMap = useMemo(() => {
    const map = new Map<string, { entryIncome: number, entryExpense: number, planIncome: number, planExpense: number }>();
    
    // We need to cover the range of months in the timeline
    const timelineMonths = getTimelinePeriods(anchorMonth, periodView, locale).flatMap(p => p.months);
    const uniqueMonths = Array.from(new Set(timelineMonths));
    
    uniqueMonths.forEach(m => {
      const entries = getEntryOccurrences(budgetState.entries, [m]);
      const entryIncome = entries.filter(e => getEntryType(e) === 'income').reduce((sum, e) => sum + e.amount, 0);
      const entryExpense = entries.filter(e => getEntryType(e) === 'expense').reduce((sum, e) => sum + e.amount, 0);
      const planIncome = sumPlanItems(budgetState.plannedItems, [m], 'income');
      const planExpense = sumPlanItems(budgetState.plannedItems, [m], 'expense');
      
      map.set(m, { entryIncome, entryExpense, planIncome, planExpense });
    });
    
    return map;
  }, [budgetState, anchorMonth, periodView, locale]);

  const timelinePoints = useMemo(() => getTimelinePeriods(anchorMonth, periodView, locale).map(period => {
    let entryIncome = 0, entryExpense = 0, planIncome = 0, planExpense = 0;
    
    period.months.forEach(m => {
      const data = monthlyDataMap.get(m);
      if (data) {
        entryIncome += data.entryIncome;
        entryExpense += data.entryExpense;
        planIncome += data.planIncome;
        planExpense += data.planExpense;
      }
    });

    const income = entryIncome > 0 ? entryIncome : planIncome;
    const expense = entryExpense > 0 ? entryExpense : planExpense;
    return { ...period, income, expense, balance: income - expense };
  }), [anchorMonth, periodView, monthlyDataMap, locale]);

  const timelineMax = Math.max(1, ...timelinePoints.flatMap(p => [p.income, p.expense]));
  const selectedTimelinePoint = timelinePoints.find(p => p.key === selectedTimelineKey) || timelinePoints[timelinePoints.length - 1];
  const selectedPeriodMonths = selectedTimelinePoint?.months ?? periodMonths;
  const selectedPeriodEntries = useMemo(
    () => getEntryOccurrences(budgetState.entries, selectedPeriodMonths),
    [budgetState.entries, selectedPeriodMonths],
  );
  const expenseRows = useMemo(
    () => buildExpenseRows(budgetState.categories, budgetState.plannedItems, selectedPeriodEntries, selectedPeriodMonths),
    [budgetState.categories, budgetState.plannedItems, selectedPeriodEntries, selectedPeriodMonths],
  );
  const incomeRows = useMemo(
    () => buildIncomeRows(budgetState.categories, budgetState.plannedItems, selectedPeriodEntries, selectedPeriodMonths),
    [budgetState.categories, budgetState.plannedItems, selectedPeriodEntries, selectedPeriodMonths],
  );
  const analysisRows = analysisKind === 'expense' ? expenseRows : incomeRows;
  const selectedTimelineBalance = selectedTimelinePoint?.balance ?? 0;
  const selectedTimelineIncome = selectedTimelinePoint?.income ?? 0;
  const selectedSavingsRate = selectedTimelineIncome > 0 
    ? `${((selectedTimelineBalance / selectedTimelineIncome) * 100).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` 
    : (0).toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

  const selectedTimelineIndex = timelinePoints.findIndex(p => p.key === (selectedTimelinePoint?.key));
  const previousTimelinePoint = selectedTimelineIndex > 0 ? timelinePoints[selectedTimelineIndex - 1] : undefined;
  const selectedTimelineDelta = previousTimelinePoint ? selectedTimelineBalance - previousTimelinePoint.balance : 0;

  const averageMonthlyIncome = timelinePoints.reduce((sum, p) => sum + p.income, 0) / timelinePoints.length;
  const averageMonthlyExpense = timelinePoints.reduce((sum, p) => sum + p.expense, 0) / timelinePoints.length;

  const timelineStepMonths = periodView === 'year' ? 12 : periodView === 'quarter' ? 3 : 1;
  const handleShiftTimeline = (direction: -1 | 1) => {
    setAnchorMonth((currentAnchorMonth) => {
      const nextAnchorMonth = addMonths(currentAnchorMonth, direction * timelineStepMonths);
      setSelectedTimelineKey(nextAnchorMonth);
      return nextAnchorMonth;
    });
    setHoveredCategoryId(undefined);
  };

  const handleResetTimeline = () => {
    setAnchorMonth(currentMonthKey);
    setSelectedTimelineKey(currentMonthKey);
    setHoveredCategoryId(undefined);
  };

  const isCurrentTimelineWindow = anchorMonth === currentMonthKey && selectedTimelinePoint?.key === currentMonthKey;

  const getRecurrenceLabel = (rec: BudgetRecurrence) => {
    const labels: Record<BudgetRecurrence, string> = {
      once: 'One-time',
      daily: 'Daily',
      weekly: 'Weekly',
      biweekly: 'Biweekly',
      monthly: 'Monthly',
      quarterly: 'Quarterly',
      semiannual: 'Semiannual',
      yearly: 'Yearly',
      custom: 'Custom'
    };
    return labels[rec] || rec;
  };

  // Handlers
  const handleSaveState = (next: any) => {
    setBudgetState(next);
    writeBudgetState(next);
  };

  const handleAddRecord = () => {
    if (recordAmount <= 0) return;

    if (isRecurring) {
      const newItem: BudgetPlanItem = {
        id: `plan-${Date.now()}`,
        name: recordName || t('Recurring item'),
        amount: recordAmount,
        type: recordType,
        categoryId: recordCategoryId || budgetState.categories.find(c => c.type === recordType)?.id || '',
        recurrence: recordRecurrence,
        month: recordDate.slice(0, 7),
        isFixed: false,
      };
      handleSaveState({ ...budgetState, plannedItems: [newItem, ...budgetState.plannedItems] });
    } else {
      const newEntry: BudgetEntry = {
        id: `entry-${Date.now()}`,
        amount: recordAmount,
        categoryId: recordCategoryId || budgetState.categories.find(c => c.type === recordType)?.id || '',
        date: new Date(recordDate).toISOString(),
        type: recordType,
        description: recordName,
      };
      handleSaveState({ ...budgetState, entries: [newEntry, ...budgetState.entries] });
    }

    setRecordName('');
    setRecordAmount(0);
  };

  const handleDeleteTransaction = (id: string) => {
    handleSaveState({ ...budgetState, entries: budgetState.entries.filter(e => e.id !== id) });
  };

  const handleDeletePlanItem = (id: string) => {
    handleSaveState({ ...budgetState, plannedItems: budgetState.plannedItems.filter(i => i.id !== id) });
  };

  const handleAddCategory = () => {
    if (!categoryName.trim()) return;

    if (editingCategoryId) {
      handleSaveState({
        ...budgetState,
        categories: budgetState.categories.map(c => c.id === editingCategoryId ? {
          ...c,
          name: categoryName.trim(),
          type: categoryType,
          group: categoryGroup,
          icon: categoryIcon,
          isFixedDefault: categoryIsFixed
        } : c)
      });
      setEditingCategoryId(null);
    } else {
      const nextCategory: BudgetCategory = {
        id: `cat-${Date.now()}`,
        name: categoryName.trim(),
        type: categoryType,
        group: categoryGroup,
        icon: categoryIcon,
        isFixedDefault: categoryIsFixed,
        color: categoryType === 'income' ? INCOME_COLORS[0] : BUDGET_CATEGORY_COLORS[0]
      };
      handleSaveState({ ...budgetState, categories: [...budgetState.categories, nextCategory] });
    }
    setCategoryName('');
  };

  const handleEditCategory = (cat: BudgetCategory) => {
    setEditingCategoryId(cat.id);
    setCategoryName(cat.name);
    setCategoryType(cat.type);
    setCategoryGroup(cat.group || 'Other');
    setCategoryIcon(cat.icon || 'help-circle');
    setCategoryIsFixed(cat.isFixedDefault || false);
  };

  const handleDeleteCategory = (id: string) => {
    handleSaveState({ ...budgetState, categories: budgetState.categories.filter(c => c.id !== id) });
  };

  const IconComponent = (name: string) => {
    const opt = iconOptions.find(o => o.name === name);
    return opt ? opt.icon : HelpCircle;
  };

  const getBudgetCategoryIcon = (cat: any) => {
    return IconComponent(cat.icon || 'help-circle');
  };

  if (!mounted) return null;

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
               <Wallet size={24} style={{ display: 'inline', marginRight: 12, verticalAlign: 'middle' }} />
               {t('My Wallet')}
            </h1>
          </div>

          <div className="tabs budget-header-tabs" role="tablist" aria-label={t('Finance Tracker')}>
            <button
              className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('overview')}
            >
              <LayoutDashboard size={14} />
              <span>{t('Overview')}</span>
            </button>
            <button
              className={`tab ${activeTab === 'records' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('records')}
            >
              <ListChecks size={14} />
              <span>{t('Tracker')}</span>
            </button>
            <button
              className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveTab('settings')}
            >
              <Settings2 size={14} />
              <span>{t('Setup')}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="compact-page-content">
        {activeTab === 'overview' && (
          <BudgetDashboard
            analysisKind={analysisKind}
            setAnalysisKind={setAnalysisKind}
            analysisRows={analysisRows}
            distributionPeriodLabel={selectedTimelinePoint?.label ?? ''}
            formatMoney={formatMoney}
            t={t}
            hoveredCategoryId={hoveredCategoryId}
            setHoveredCategoryId={setHoveredCategoryId}
            timelinePoints={timelinePoints}
            selectedTimelinePoint={selectedTimelinePoint}
            setSelectedTimelineKey={setSelectedTimelineKey}
            onShiftTimeline={handleShiftTimeline}
            onResetTimeline={handleResetTimeline}
            isCurrentTimelineWindow={isCurrentTimelineWindow}
            timelineMax={timelineMax}
            selectedTimelineDelta={selectedTimelineDelta}
            selectedTimelineBalance={selectedTimelineBalance}
            selectedSavingsRate={selectedSavingsRate}
            averageMonthlyIncome={averageMonthlyIncome}
            averageMonthlyExpense={averageMonthlyExpense}
          />
        )}

        {activeTab === 'records' && (
          <BudgetRecords
            recordType={recordType}
            setRecordType={setRecordType}
            isRecurring={isRecurring}
            setIsRecurring={setIsRecurring}
            name={recordName}
            setName={setRecordName}
            amount={recordAmount}
            setAmount={setRecordAmount}
            categoryId={recordCategoryId}
            setCategoryId={setRecordCategoryId}
            date={recordDate}
            setDate={setRecordDate}
            recurrence={recordRecurrence}
            setRecurrence={setRecordRecurrence}
            onAddRecord={handleAddRecord}
            onDeleteTransaction={handleDeleteTransaction}
            onDeletePlanItem={handleDeletePlanItem}
            categories={budgetState.categories}
            transactions={budgetState.entries}
            planItems={budgetState.plannedItems}
            formatMoney={formatMoney}
            t={t}
            getBudgetCategoryIcon={getBudgetCategoryIcon}
            getRecurrenceLabel={getRecurrenceLabel}
          />
        )}

        {activeTab === 'settings' && (
          <BudgetSettings
            categories={budgetState.categories}
            categoryName={categoryName}
            setCategoryName={setCategoryName}
            categoryType={categoryType}
            setCategoryType={setCategoryType}
            categoryGroup={categoryGroup}
            setCategoryGroup={setCategoryGroup}
            categoryIcon={categoryIcon}
            setCategoryIcon={setCategoryIcon}
            categoryIsFixed={categoryIsFixed}
            setCategoryIsFixed={setCategoryIsFixed}
            editingCategoryId={editingCategoryId}
            onAddCategory={handleAddCategory}
            onEditCategory={handleEditCategory}
            onDeleteCategory={handleDeleteCategory}
            iconOptions={iconOptions}
            t={t}
            IconComponent={IconComponent}
          />
        )}
      </div>
    </AppShell>
  );
}
