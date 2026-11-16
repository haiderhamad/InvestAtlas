import React from 'react';
import { Plus, Trash2, Edit3, LayoutGrid, type LucideIcon } from 'lucide-react';
import { type BudgetCategory, type BudgetEntryType } from '../../../lib/budget/budget-store';

interface BudgetSettingsProps {
  categories: BudgetCategory[];
  categoryName: string;
  setCategoryName: (val: string) => void;
  categoryType: BudgetEntryType;
  setCategoryType: (val: BudgetEntryType) => void;
  categoryGroup: string;
  setCategoryGroup: (val: string) => void;
  categoryIcon: string;
  setCategoryIcon: (val: string) => void;
  categoryIsFixed: boolean;
  setCategoryIsFixed: (val: boolean) => void;
  editingCategoryId: string | null;
  
  onAddCategory: () => void;
  onEditCategory: (cat: BudgetCategory) => void;
  onDeleteCategory: (id: string) => void;
  
  iconOptions: any[];
  t: (key: string) => string;
  IconComponent: (name: string) => LucideIcon;
}

export function BudgetSettings({
  categories,
  categoryName,
  setCategoryName,
  categoryType,
  setCategoryType,
  categoryGroup,
  setCategoryGroup,
  categoryIcon,
  setCategoryIcon,
  editingCategoryId,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  iconOptions,
  t,
  IconComponent,
}: BudgetSettingsProps) {
  return (
    <div className="budget-settings-tab animate-in">
      <div className="budget-cockpit-forms">
        <div className="card budget-form-cockpit premium-surface">
          <div className="panel-header-toolbar">
            <div className="panel-title-group">
              <div className="section-title">{t(editingCategoryId ? 'Edit category' : 'New category')}</div>
              <div className="panel-subtitle">{t('Customize your financial buckets.')}</div>
            </div>
            <div className="budget-segmented-pill">
              {(['expense', 'income'] as const).map((type) => (
                <button
                  key={type}
                  className={categoryType === type ? `active ${type}` : ''}
                  onClick={() => setCategoryType(type)}
                >
                  {t(type === 'expense' ? 'Expense' : 'Income')}
                </button>
              ))}
            </div>
          </div>

          <div className="budget-form-compact-grid">
            <div className="form-group-compact flex-2">
              <label className="label-faint">{t('Name')}</label>
              <input
                className="input-premium"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder={t('e.g. Subscriptions')}
              />
            </div>
            <div className="form-group-compact">
              <label className="label-faint">{t('Group')}</label>
              <input
                className="input-premium"
                value={categoryGroup}
                onChange={(e) => setCategoryGroup(e.target.value)}
                placeholder={t('e.g. Living')}
              />
            </div>
            
            <div className="form-row-actions">
              <div className="icon-selector-compact">
                <label className="label-faint">{t('Icon')}</label>
                <div className="icon-dot-grid">
                  {iconOptions.slice(0, 8).map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button 
                        key={opt.name} 
                        className={`icon-dot-pill ${categoryIcon === opt.name ? 'active' : ''}`}
                        onClick={() => setCategoryIcon(opt.name)}
                      >
                        <Icon size={14} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <button 
                className={`btn-premium-pill ${categoryType === 'income' ? 'income' : 'expense'}`} 
                onClick={onAddCategory}
              >
                {editingCategoryId ? <Edit3 size={16} /> : <Plus size={16} />}
                {t(editingCategoryId ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="budget-lists-cockpit" style={{ marginTop: 24 }}>
        {(['income', 'expense'] as BudgetEntryType[]).map((type) => (
          <div key={type} className="card list-panel premium-surface">
            <div className="panel-header-compact">
              <div className="section-title">
                {t(type === 'income' ? 'Income categories' : 'Expense categories')}
              </div>
              <span className={`badge ${type === 'income' ? 'badge-green' : 'badge-red'}`}>
                {categories.filter(c => c.type === type).length}
              </span>
            </div>
            <div className="budget-list-refined">
              {categories.filter(c => c.type === type).map((cat) => {
                const Icon = IconComponent(cat.icon || 'help-circle');
                return (
                  <div key={cat.id} className="budget-list-row-compact">
                    <div className="row-icon-box" style={{ background: `${cat.color || 'var(--accent-blue)'}10`, color: cat.color || 'var(--accent-blue)' }}>
                      <Icon size={14} />
                    </div>
                    <div className="row-main">
                      <span className="row-title">{t(cat.name)}</span>
                      {cat.group && <span className="row-meta">{t(cat.group)}</span>}
                    </div>
                    <div className="row-actions-group">
                      <button className="row-action-icon" onClick={() => onEditCategory(cat)}>
                        <Edit3 size={13} />
                      </button>
                      <button className="row-action-icon" onClick={() => onDeleteCategory(cat.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
