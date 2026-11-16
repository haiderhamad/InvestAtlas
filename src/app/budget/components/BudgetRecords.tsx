import { Plus, Trash2 } from 'lucide-react';
import { 
  type BudgetEntry, 
  type BudgetPlanItem, 
  type BudgetEntryType, 
  type BudgetRecurrence 
} from '../../../lib/budget/budget-store';

interface BudgetRecordsProps {
  // State for forms
  recordType: BudgetEntryType;
  setRecordType: (val: BudgetEntryType) => void;
  isRecurring: boolean;
  setIsRecurring: (val: boolean) => void;
  
  name: string;
  setName: (val: string) => void;
  amount: number;
  setAmount: (val: number) => void;
  categoryId: string;
  setCategoryId: (val: string) => void;
  date: string;
  setDate: (val: string) => void;
  recurrence: BudgetRecurrence;
  setRecurrence: (val: BudgetRecurrence) => void;
  
  // Actions
  onAddRecord: () => void;
  onDeleteTransaction: (id: string) => void;
  onDeletePlanItem: (id: string) => void;
  
  // Data
  categories: any[];
  transactions: BudgetEntry[];
  planItems: BudgetPlanItem[];
  formatMoney: (val: number) => string;
  t: (key: string) => string;
  getBudgetCategoryIcon: (cat: any) => any;
  getRecurrenceLabel: (rec: BudgetRecurrence) => string;
}

export function BudgetRecords({
  recordType,
  setRecordType,
  isRecurring,
  setIsRecurring,
  name,
  setName,
  amount,
  setAmount,
  categoryId,
  setCategoryId,
  date,
  setDate,
  recurrence,
  setRecurrence,
  onAddRecord,
  onDeleteTransaction,
  onDeletePlanItem,
  categories,
  transactions,
  planItems,
  formatMoney,
  t,
  getBudgetCategoryIcon,
  getRecurrenceLabel,
}: BudgetRecordsProps) {
  const filteredCategories = categories.filter(c => c.type === recordType);
  
  return (
    <div className="budget-records-tab animate-in">
      <div className="budget-cockpit-forms">
        <div className="card budget-form-cockpit premium-surface">
          <div className="panel-header-toolbar">
            <div className="panel-title-group">
              <div className="section-title">{t(isRecurring ? 'Plan recurring' : 'Add record')}</div>
              <div className="panel-subtitle">{t('Quickly log your finances.')}</div>
            </div>
            <div className="budget-segmented-pill">
              <button 
                className={!isRecurring ? 'active' : ''} 
                onClick={() => setIsRecurring(false)}
              >
                {t('One-time')}
              </button>
              <button 
                className={isRecurring ? 'active' : ''} 
                onClick={() => setIsRecurring(true)}
              >
                {t('Recurring')}
              </button>
            </div>
          </div>

          <div className="budget-form-compact-grid">
            <div className="form-group-compact">
              <label className="label-faint">{t('Label')}</label>
              <input
                className="input-premium"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(recordType === 'income' ? 'e.g. Salary' : 'e.g. Rent')}
              />
            </div>
            <div className="form-group-compact">
              <label className="label-faint">{t('Amount')}</label>
              <div className="input-with-symbol">
                <span className="symbol">€</span>
                <input
                  className="input-premium"
                  type="number"
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="form-group-compact">
              <label className="label-faint">{t('Category')}</label>
              <select className="select-premium" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('Select category')}</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{t(cat.name)}</option>
                ))}
              </select>
            </div>
            <div className="form-group-compact">
              <label className="label-faint">{t(isRecurring ? 'Start month' : 'Date')}</label>
              <input
                className="input-premium"
                type={isRecurring ? 'month' : 'date'}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="form-row-actions">
              <div className="form-row-actions-left">
                <div className="budget-segmented-pill type-selector">
                  {(['expense', 'income'] as const).map((type) => (
                    <button
                      key={type}
                      className={recordType === type ? `active ${type}` : ''}
                      onClick={() => setRecordType(type)}
                    >
                      {t(type === 'expense' ? 'Expense' : 'Income')}
                    </button>
                  ))}
                </div>

                {isRecurring && (
                  <div className="budget-segmented-pill recurrence-selector">
                    {(['weekly', 'monthly', 'yearly'] as const).map((opt) => (
                      <button
                        key={opt}
                        className={recurrence === opt ? 'active' : ''}
                        onClick={() => setRecurrence(opt)}
                        type="button"
                      >
                        {t(opt === 'weekly' ? 'Weekly' : opt === 'monthly' ? 'Monthly' : 'Yearly')}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button className={`btn-premium-pill ${recordType === 'income' ? 'income' : 'expense'}`} onClick={onAddRecord}>
                <Plus size={16} />
                {t('Save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="budget-lists-cockpit" style={{ marginTop: 24 }}>
        <div className="card list-panel premium-surface">
          <div className="panel-header-compact">
            <div className="section-title">{t('Recent transactions')}</div>
            <span className="badge badge-faint">{transactions.length}</span>
          </div>
          <div className="budget-list-refined">
            {transactions.length === 0 ? (
              <div className="empty-state-small">{t('No transactions yet')}</div>
            ) : (
              transactions.slice(0, 8).map((entry) => {
                const category = categories.find(c => c.id === entry.categoryId);
                const Icon = getBudgetCategoryIcon(category || { name: 'Other', icon: 'help-circle' });
                return (
                  <div key={entry.id} className="budget-list-row-compact">
                    <div className="row-icon-box" style={{ background: `${category?.color || 'var(--accent-blue)'}10`, color: category?.color || 'var(--accent-blue)' }}>
                      <Icon size={14} />
                    </div>
                    <div className="row-main">
                      <span className="row-title">{entry.description || t(category?.name || 'Other')}</span>
                      <span className="row-meta">{entry.date.slice(0, 10)}</span>
                    </div>
                    <div className={`row-amount ${entry.type}`}>
                      {entry.type === 'income' ? '+' : '-'}{formatMoney(entry.amount)}
                    </div>
                    <button className="row-action-icon" onClick={() => onDeleteTransaction(entry.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card list-panel premium-surface">
          <div className="panel-header-compact">
            <div className="section-title">{t('Recurring items')}</div>
            <span className="badge badge-faint">{planItems.length}</span>
          </div>
          <div className="budget-list-refined">
            {planItems.length === 0 ? (
              <div className="empty-state-small">{t('No recurring items')}</div>
            ) : (
              planItems.map((item) => {
                const category = categories.find(c => c.id === item.categoryId);
                const Icon = getBudgetCategoryIcon(category || { name: 'Other', icon: 'help-circle' });
                return (
                  <div key={item.id} className="budget-list-row-compact">
                    <div className="row-icon-box" style={{ background: `${category?.color || 'var(--accent-teal)'}10`, color: category?.color || 'var(--accent-teal)' }}>
                      <Icon size={14} />
                    </div>
                    <div className="row-main">
                      <span className="row-title">{item.name || t(category?.name || 'Other')}</span>
                      <span className="row-meta">{t(getRecurrenceLabel(item.recurrence))}</span>
                    </div>
                    <div className={`row-amount ${item.type}`}>
                      {item.type === 'income' ? '+' : ''}{formatMoney(item.amount)}
                    </div>
                    <button className="row-action-icon" onClick={() => onDeletePlanItem(item.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

