'use client';

import {
  AlertTriangle,
  Shield,
  ArrowLeftRight,
  Settings2,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import {
  type TaxProfileSettings,
  type TaxProfileMode,
  getEffectiveTaxProfile,
} from '@/lib/tax/tax-profile';
import { useState } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface TaxProfileSettingsProps {
  settings: TaxProfileSettings;
  onUpdate: (next: TaxProfileSettings) => void;
  ioMessage?: string | null;
}

function SummaryRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '10px 14px',
      background: 'var(--surface-soft)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function ModeCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        border: selected ? '2px solid var(--accent-blue)' : '2px solid var(--border)',
        background: selected ? 'color-mix(in srgb, var(--accent-blue) 6%, transparent)' : 'var(--surface-soft)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s, background 0.15s',
        width: '100%',
      }}
    >
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: selected ? 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' : 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: selected ? 'var(--accent-blue)' : 'var(--text-muted)',
        flexShrink: 0,
        marginTop: 1,
      }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: selected ? 'var(--accent-blue)' : 'var(--text-primary)' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{description}</div>
      </div>
    </button>
  );
}

export default function TaxProfileSettingsComponent({
  settings,
  onUpdate,
  ioMessage,
}: TaxProfileSettingsProps) {
  const { t, language } = useAppTranslation();
  const [germanyExpanded, setGermanyExpanded] = useState(false);

  const effective = getEffectiveTaxProfile(settings, new Date().getFullYear());
  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';

  const setMode = (mode: TaxProfileMode) => onUpdate({ ...settings, mode });

  const updateManual = (partial: Partial<TaxProfileSettings['manual']>) =>
    onUpdate({ ...settings, manual: { ...settings.manual, ...partial } });

  const formatPct = (rate: number) => `${(rate * 100).toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const formatEur = (val: number) => val === 0
    ? t('None')
    : new Intl.NumberFormat(numberLocale, {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 2,
      }).format(val);
  const formatDays = (days: number) => {
    if (days === 0) return t('No benefit');
    if (days >= 365) return t(`${Math.round(days / 365)} year`);
    return t(`${days} days`);
  };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Active profile summary */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                {t('Active tax profile')}
              </div>
              {effective.needsUserConfirmation && (
                <span className="badge badge-orange" style={{ fontSize: 10 }}>{t('Needs confirmation')}</span>
              )}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {effective.countryLabel}
              {effective.isPreset && (
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-blue)', marginLeft: 8 }}>
                  {t('Standard preset')}
                </span>
              )}
            </div>
          </div>
        </div>

        {ioMessage && (
          <div className="callout info" style={{ marginBottom: 14 }}>{ioMessage}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <SummaryRow
            label={t('Income tax rate')}
            value={formatPct(effective.personalIncomeTaxRate)}
            sub={t('Crypto & metals')}
          />
          <SummaryRow
            label={t('Capital gains tax')}
            value={formatPct(effective.capitalIncomeTaxRate)}
            sub={t('Stocks & ETFs')}
          />
          <SummaryRow
            label={t('Stock/ETF allowance')}
            value={formatEur(effective.capitalIncomeAllowance)}
            sub={t('Tax-free per year')}
          />
          <SummaryRow
            label={t('Crypto/metals allowance')}
            value={formatEur(effective.privateSaleAllowance)}
            sub={t('Tax-free threshold')}
          />
          <SummaryRow
            label={t('Tax-free after')}
            value={formatDays(effective.privateSaleHoldingPeriodDays)}
            sub={t('Holding period')}
          />
        </div>
      </div>

      {/* Mode selector + configuration */}
      <div className="card">
        <div className="section-title" style={{ marginBottom: 4 }}>{t('Tax Profile Setup')}</div>
        <div className="panel-subtitle" style={{ marginBottom: 16 }}>
          {t('Choose how tax rates are determined for your portfolio.')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          <ModeCard
            selected={settings.mode === 'preset'}
            onClick={() => setMode('preset')}
            icon={<Shield size={16} />}
            title={t('Germany — Standard Preset')}
            description={t('Built-in German tax rules: 26.375% Abgeltungsteuer for stocks/ETFs, personal income tax for crypto & metals, 1-year holding period.')}
          />
          <ModeCard
            selected={settings.mode === 'manual'}
            onClick={() => setMode('manual')}
            icon={<Settings2 size={16} />}
            title={t('Custom Setup')}
            description={t('Manually enter your country\'s tax rates, allowances, and holding period rules.')}
          />
        </div>

        {/* Germany preset config */}
        {settings.mode === 'preset' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldRow
              label={t('Your personal income tax rate (%)')}
              hint={t('Applied to crypto & precious metals gains if sold within 1 year. This varies per person — enter your marginal rate.')}
            >
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={settings.presetPersonalIncomeTaxRatePct}
                onChange={e => onUpdate({ ...settings, presetPersonalIncomeTaxRatePct: Number(e.target.value) })}
                style={{ maxWidth: 160 }}
              />
            </FieldRow>

            <button
              onClick={() => setGermanyExpanded(!germanyExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: 12,
                padding: '4px 0',
              }}
            >
              <Info size={13} />
              {germanyExpanded ? t('Hide preset details') : t('Show what the Germany preset includes')}
              {germanyExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {germanyExpanded && (
              <div className="callout info" style={{ flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('Germany preset values (fixed)')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('Capital gains tax (Abgeltungsteuer):')}</span> <strong>26.375%</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('Stock/ETF allowance (Sparerpauschbetrag):')}</span> <strong>{t('€1,000/year')}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('Crypto/metals tax-free threshold (Freigrenze):')}</span> <strong>{t('€1,000/year')}</strong></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('Tax-free holding period:')}</span> <strong>{t('1 year')}</strong></div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{t('Freigrenze rule:')}</span> <strong>{t('Threshold — if you exceed €1,000, the full amount becomes taxable (not just the excess).')}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual config */}
        {settings.mode === 'manual' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FieldRow
                label={t('Country name')}
                hint={t('Just a label — for your reference.')}
              >
                <input
                  className="input"
                  value={settings.manual.countryLabel}
                  onChange={e => updateManual({ countryLabel: e.target.value })}
                  placeholder={t('e.g. Austria')}
                />
              </FieldRow>

              <FieldRow
                label={t('Personal income tax rate (%)')}
                hint={t('Applied to crypto & metals gains within the holding period.')}
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={settings.manual.personalIncomeTaxRatePct}
                  onChange={e => updateManual({ personalIncomeTaxRatePct: Number(e.target.value) })}
                />
              </FieldRow>

              <FieldRow
                label={t('Capital gains tax rate (%)')}
                hint={t('Applied to stocks, ETFs, and dividends.')}
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={settings.manual.capitalIncomeTaxRatePct}
                  onChange={e => updateManual({ capitalIncomeTaxRatePct: Number(e.target.value) })}
                />
              </FieldRow>

              <FieldRow
                label={t('Annual tax-free allowance — stocks/ETFs (€)')}
                hint={t('Gains up to this amount per year are not taxed. Set 0 if your country has no allowance.')}
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={settings.manual.capitalIncomeAllowance}
                  onChange={e => updateManual({ capitalIncomeAllowance: Number(e.target.value) })}
                />
              </FieldRow>

              <FieldRow
                label={t('Tax-free threshold — crypto/metals (€)')}
                hint={t('Annual gain limit for crypto & metals. Set 0 if there is no threshold.')}
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={settings.manual.privateSaleAllowance}
                  onChange={e => updateManual({ privateSaleAllowance: Number(e.target.value) })}
                />
              </FieldRow>

              <FieldRow
                label={t('Tax-free holding period (days)')}
                hint={t('Crypto & metals held longer than this are completely tax-free. Set 0 if there is no holding period benefit.')}
              >
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={settings.manual.privateSaleHoldingPeriodDays}
                  onChange={e => updateManual({ privateSaleHoldingPeriodDays: Number(e.target.value) })}
                />
              </FieldRow>
            </div>

            {settings.manual.privateSaleAllowance > 0 && (
              <FieldRow
                label={t('When gains exceed the threshold')}
                hint={t('Defines what gets taxed once your crypto/metals gains pass the limit.')}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    onClick={() => updateManual({ privateSaleAllowanceMode: 'allowance_exemption' })}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: settings.manual.privateSaleAllowanceMode === 'allowance_exemption'
                        ? '2px solid var(--accent-blue)'
                        : '2px solid var(--border)',
                      background: settings.manual.privateSaleAllowanceMode === 'allowance_exemption'
                        ? 'color-mix(in srgb, var(--accent-blue) 6%, transparent)'
                        : 'var(--surface-soft)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid', borderColor: settings.manual.privateSaleAllowanceMode === 'allowance_exemption' ? 'var(--accent-blue)' : 'var(--border)', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {settings.manual.privateSaleAllowanceMode === 'allowance_exemption' && (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-blue)' }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('Only tax the excess')}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('Example: €1,200 gain with €1,000 threshold → only €200 is taxed.')}
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => updateManual({ privateSaleAllowanceMode: 'all_or_nothing' })}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: settings.manual.privateSaleAllowanceMode === 'all_or_nothing'
                        ? '2px solid var(--accent-blue)'
                        : '2px solid var(--border)',
                      background: settings.manual.privateSaleAllowanceMode === 'all_or_nothing'
                        ? 'color-mix(in srgb, var(--accent-blue) 6%, transparent)'
                        : 'var(--surface-soft)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid', borderColor: settings.manual.privateSaleAllowanceMode === 'all_or_nothing' ? 'var(--accent-blue)' : 'var(--border)', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {settings.manual.privateSaleAllowanceMode === 'all_or_nothing' && (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-blue)' }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t('Tax the full amount once exceeded')}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('Example: €1,200 gain with €1,000 threshold → the entire €1,200 is taxed. (German Freigrenze rule)')}
                      </div>
                    </div>
                  </button>
                </div>
              </FieldRow>
            )}
          </div>
        )}


      </div>

      {/* General Tax Logic */}
      <div className="card">
        <div className="section-title" style={{ marginBottom: 4 }}>{t('General Tax Logic')}</div>
        <div className="panel-subtitle" style={{ marginBottom: 14 }}>
          {t('These rules apply regardless of your tax profile.')}
        </div>
        <div className="grid-2">
          <div className="insight-row">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)' }}>
                <Settings2 size={16} />
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{t('Fee Treatment')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Trading fees are added to your cost basis, reducing taxable gains.')}</div>
              </div>
            </div>
            <span className="badge badge-green">{t('Enabled')}</span>
          </div>
          <div className="insight-row">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-teal)' }}>
                <ArrowLeftRight size={16} />
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{t('Crypto-to-Crypto Swaps')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Swapping one crypto for another counts as a taxable disposal (sale).')}</div>
              </div>
            </div>
            <span className="badge badge-blue">{t('Taxable')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
