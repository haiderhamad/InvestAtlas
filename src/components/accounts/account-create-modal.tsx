'use client';

import { BadgePlus, Building2, Landmark, ShieldCheck, Wallet2, X } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import type {
  ManualAccountCashCategory,
  ManualAccountCashRoute,
  ManualAccountPortfolioScope,
} from '@/lib/accounts/manual-accounts-store';

const KIND_LABELS = {
  Brokerage: 'Brokerage',
  'Bank Account': 'Bank Account',
  'Savings Account': 'Saving Cash',
  Exchange: 'Exchange',
  Vault: 'Vault',
  Other: 'Other',
} as const;

const KIND_ICONS = {
  Brokerage: Building2,
  'Bank Account': Landmark,
  'Savings Account': Landmark,
  Exchange: Wallet2,
  Vault: ShieldCheck,
  Other: BadgePlus,
} as const;

interface Preset {
  id: string;
  label: string;
  description: string;
  kind: keyof typeof KIND_LABELS;
  placeholder: string;
  notesPlaceholder: string;
}

interface AccountCreateModalProps {
  presets: readonly Preset[];
  selectedPresetId: string;
  onSelectPreset: (id: string) => void;
  label: string;
  notes: string;
  portfolioScope: ManualAccountPortfolioScope;
  cashCategory: ManualAccountCashCategory;
  cashRoutes: ManualAccountCashRoute[];
  formError: string | null;
  isSubmitting?: boolean;
  onChangeLabel: (value: string) => void;
  onChangeNotes: (value: string) => void;
  onChangeCashPurpose: (scope: ManualAccountPortfolioScope, category: ManualAccountCashCategory) => void;
  onChangeCashRoutes: (routes: ManualAccountCashRoute[]) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export default function AccountCreateModal({
  presets,
  selectedPresetId,
  onSelectPreset,
  label,
  notes,
  portfolioScope,
  cashCategory,
  cashRoutes,
  formError,
  isSubmitting = false,
  onChangeLabel,
  onChangeNotes,
  onChangeCashPurpose,
  onChangeCashRoutes,
  onClose,
  onSubmit,
}: AccountCreateModalProps) {
  const { t } = useAppTranslation();
  const currentPreset = presets.find(p => p.id === selectedPresetId) || presets[0];
  const showsCashPurpose = false;
  const showsCashRoutes = currentPreset.kind === 'Bank Account' && cashCategory === 'investment_cash';
  const toggleCashRoute = (route: ManualAccountCashRoute) => {
    const next = cashRoutes.includes(route)
      ? cashRoutes.filter((item) => item !== route)
      : [...cashRoutes, route];
    onChangeCashRoutes(next);
  };
  
  return (
    <Dialog 
      open 
      onClose={onClose} 
      labelledBy="account-create-title"
      contentStyle={{ 
        width: '100%', 
        maxWidth: 540, 
        padding: '32px 32px 28px', 
        borderRadius: 24,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)'
      }}
    >
        {/* ── Modal Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ flex: 1 }}>
            <h2
              id="account-create-title"
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: 'var(--text-primary)',
                lineHeight: 1.1,
                margin: '0 0 12px',
                letterSpacing: '-0.02em'
              }}
            >
              {t('Create manually managed portfolio')}
            </h2>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, opacity: 0.8 }}>
              {t(currentPreset.description)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 16,
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.2s ease'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Type Selection Pills ── */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
            {t('Type')}
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {presets.map((preset) => {
              const Icon = KIND_ICONS[preset.kind];
              const isActive = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  onClick={() => onSelectPreset(preset.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 16px',
                    borderRadius: 100,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: isActive ? 'rgba(var(--accent-blue-rgb), 0.15)' : 'var(--surface)',
                    border: isActive ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
                    color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={14} />
                  {t(KIND_LABELS[preset.kind])}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Form Fields ── */}
        <div style={{ display: 'grid', gap: 24, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              {t('Portfolio Name')}
            </label>
            <input
              autoFocus
              style={{
                width: '100%',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                padding: '14px 16px',
                borderRadius: 12,
                color: 'var(--text-primary)',
                fontSize: 15,
                outline: 'none',
                transition: 'border-color 0.2s ease'
              }}
              value={label}
              onChange={(event) => onChangeLabel(event.target.value)}
              placeholder={t(currentPreset.placeholder)}
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              {t('Bank Name (Optional)')}
            </label>
            <input
              style={{
                width: '100%',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                padding: '14px 16px',
                borderRadius: 12,
                color: 'var(--text-primary)',
                fontSize: 15,
                outline: 'none',
                transition: 'border-color 0.2s ease'
              }}
              value={notes}
              onChange={(event) => onChangeNotes(event.target.value)}
              placeholder={t(currentPreset.notesPlaceholder)}
            />
          </div>
          {showsCashPurpose ? (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10, display: 'block' }}>
                {t('Purpose')}
              </label>
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  {
                    id: 'investment_cash',
                    label: 'Investment-Cash',
                    description: 'Zentrales Cash für Käufe und Verkaufserlöse.',
                    scope: 'portfolio' as const,
                    category: 'investment_cash' as const,
                  },
                  {
                    id: 'savings_cash',
                    label: 'Saving Cash / Sparkonto',
                    description: 'Separates Spar-Cash, nicht als Kauf-Cash für Trades.',
                    scope: 'portfolio' as const,
                    category: 'savings_cash' as const,
                  },
                ].map((option) => {
                  const active = portfolioScope === option.scope && cashCategory === option.category;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onChangeCashPurpose(option.scope, option.category)}
                      style={{
                        textAlign: 'left',
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: active ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
                        background: active ? 'rgba(var(--accent-blue-rgb), 0.12)' : 'var(--surface)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 750 }}>{t(option.label)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                        {t(option.description)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {showsCashRoutes ? (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10, display: 'block' }}>
                {t('Use this Investment-Cash for')}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {[
                  { route: 'stock' as const, label: 'Aktien' },
                  { route: 'etf' as const, label: 'ETF' },
                  { route: 'crypto' as const, label: 'Krypto' },
                  { route: 'metal' as const, label: 'Gold / Metalle' },
                ].map((option) => {
                  const active = cashRoutes.includes(option.route);
                  return (
                    <button
                      key={option.route}
                      type="button"
                      onClick={() => toggleCashRoute(option.route)}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: active ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
                        background: active ? 'rgba(var(--accent-blue-rgb), 0.12)' : 'var(--surface)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      {t(option.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <button 
            type="button" 
            onClick={onClose}
            style={{ 
              flex: 1, 
              padding: '14px 0', 
              fontSize: 15, 
              fontWeight: 700, 
              borderRadius: 12, 
              background: 'var(--surface)', 
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              cursor: 'pointer'
            }}
          >
            {t('Cancel')}
          </button>
          <button 
            type="button" 
            onClick={onSubmit}
            disabled={isSubmitting}
            style={{ 
              flex: 1.5, 
              padding: '14px 0', 
              fontSize: 15, 
              fontWeight: 700, 
              borderRadius: 12, 
              background: 'linear-gradient(135deg, var(--accent-blue), #5eafff)', 
              border: 'none',
              color: 'white',
              cursor: isSubmitting ? 'wait' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
              boxShadow: '0 4px 12px var(--focus-ring)'
            }}
          >
            {isSubmitting ? t('Saving...') : t('Create Account')}
          </button>
        </div>

        {formError && (
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(var(--red-rgb), 0.1)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 13 }}>
            ⚠ {t(formError)}
          </div>
        )}
    </Dialog>
  );
}
