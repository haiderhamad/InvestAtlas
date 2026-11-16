'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Database,
  Download,
  FileCheck2,
  LogOut,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { type LocalAccountProfile } from '@/lib/preferences/app-preferences';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  applyAccountImportPlan,
  downloadAccountExportCsv,
  hasNonReplaceableAccountIdentityConflict,
  parseAccountExportCsv,
  type AccountImportPlan,
} from '@/lib/account-data/account-data-io';

interface AccountSettingsProps {
  profile: LocalAccountProfile;
  draft: { fullName: string; email: string };
  setDraft: (draft: { fullName: string; email: string }) => void;
  onSave: () => void;
  onSignOut: () => void;
  onDelete: () => void | Promise<void>;
  canDeleteAccount?: boolean;
  isCloudAccount?: boolean;
}

export default function AccountSettings({
  profile,
  draft,
  setDraft,
  onSave,
  onSignOut,
  onDelete,
  canDeleteAccount = profile.signedIn,
  isCloudAccount = false,
}: AccountSettingsProps) {
  const { t, language } = useAppTranslation();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [deleteExported, setDeleteExported] = useState(false);
  const [deleteWithoutExport, setDeleteWithoutExport] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [importPlan, setImportPlan] = useState<AccountImportPlan | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Determine the expected phrase based on language
  const getExpectedPhrase = () => {
    if (language === 'de') return 'Lösche meinen Account';
    if (language === 'ar') return 'احذف حسابي';
    return 'Delete my account';
  };

  const expectedPhrase = getExpectedPhrase();

  const handleDeleteClick = () => {
    setShowConfirmation(true);
    setDeleteExported(false);
    setDeleteWithoutExport(false);
  };

  const handleConfirmDelete = () => {
    if (confirmationInput.trim() === expectedPhrase.trim() && (deleteExported || deleteWithoutExport)) {
      setDeleteBusy(true);
      void Promise.resolve(onDelete())
        .catch(() => undefined)
        .finally(() => {
          setDeleteBusy(false);
        });
    }
  };

  const handleExport = async () => {
    setExportBusy(true);
    setImportMessage(null);
    try {
      await downloadAccountExportCsv();
      setDeleteExported(true);
    } catch {
      setImportMessage(t('Account data export could not be created. Please try again.'));
    } finally {
      setExportBusy(false);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setImportBusy(true);
    setImportMessage(null);
    setImportPlan(null);

    try {
      const plan = await parseAccountExportCsv(file);
      setImportPlan(plan);
      setImportMessage(
        plan.conflicts.length > 0
          ? t('Import ready. Existing data conflicts need your confirmation.')
          : t('Import ready. No conflicts found.'),
      );
    } catch {
      setImportMessage(t('The selected account export is invalid or unsupported.'));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleApplyImport = async (mode: 'append' | 'replace-conflicts') => {
    if (!importPlan) return;
    setImportBusy(true);
    setImportMessage(null);

    try {
      await applyAccountImportPlan(importPlan, mode);
      setImportMessage(t('Account data imported successfully.'));
      setImportPlan(null);
    } catch {
      setImportMessage(t('Import could not be saved. Please reload the page and try again.'));
    } finally {
      setImportBusy(false);
    }
  };

  const canDelete =
    !deleteBusy
    && confirmationInput.trim() === expectedPhrase.trim()
    && (deleteExported || deleteWithoutExport);
  const hasNonReplaceableImportConflict =
    importPlan !== null
    && hasNonReplaceableAccountIdentityConflict(importPlan.conflicts);

  return (
    <div className="card animate-in">
      {showConfirmation ? (
        <div className="animate-in" style={{ padding: 24 }}>
          <button 
            className="btn btn-ghost" 
            onClick={() => setShowConfirmation(false)}
            style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}
          >
            <ArrowLeft size={16} />
            {t('Back')}
          </button>
          
          <div className="section-title" style={{ color: 'var(--accent-red)', fontSize: '18px', fontWeight: 700 }}>
            {t('Are you sure you want to delete your account?')}
          </div>
          <p className="panel-subtitle" style={{ marginTop: 8, marginBottom: 24, fontSize: '14px', color: 'var(--text-muted)' }}>
            {isCloudAccount
              ? t('This action is permanent and will delete all your data from Firebase.')
              : t("This action permanently deletes this browser's Local Workspace data.")}
          </p>

          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: '1px solid var(--surface-warning-border)',
              background: 'var(--surface-warning)',
              marginBottom: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={18} style={{ color: 'var(--yellow)', marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{t('Export before deleting')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {t('Download your account data first if you may want to restore it later.')}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void handleExport()} disabled={exportBusy} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Download size={14} />
                {exportBusy
                  ? t('Preparing export...')
                  : deleteExported
                    ? t('Export downloaded')
                    : t('Export account data')}
              </button>
              <button
                className={`btn btn-sm ${deleteWithoutExport ? 'btn-primary' : 'btn-secondary'}`}
                type="button"
                onClick={() => setDeleteWithoutExport(true)}
              >
                {t('Continue without export')}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label className="label" style={{ marginBottom: 12, display: 'block', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {t('To confirm, please type')} <strong style={{ color: 'var(--text-primary)' }}>"{expectedPhrase}"</strong>
            </label>
            <input
              className="input"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={expectedPhrase}
              style={{ 
                width: '100%', 
                padding: '12px', 
                borderRadius: '8px', 
                border: '1px solid',
                borderColor: confirmationInput.trim() === expectedPhrase.trim() ? 'var(--accent-green)' : 'var(--surface-border-soft)',
                background: 'var(--surface-soft)',
                color: 'var(--text-primary)'
              }}
            />
          </div>

          <button 
            className="btn" 
            onClick={handleConfirmDelete} 
            disabled={!canDelete}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              gap: 8, 
              width: '100%', 
              padding: '12px',
              borderRadius: '8px',
              background: 'var(--red)',
              border: '1px solid var(--red)',
              opacity: canDelete ? 1 : 0.5,
              color: 'white',
              cursor: canDelete ? 'pointer' : 'not-allowed',
              fontWeight: 700
            }}
          >
            <Trash2 size={16} />
            {deleteBusy ? t('Deleting account...') : t('Permanently Delete My Account')}
          </button>
        </div>
      ) : (
        <>
          <div className="panel-header" style={{ padding: 24, borderBottom: '1px solid var(--surface-border-faint)' }}>
            <div>
              <div className="section-title">{t('Account & Session')}</div>
              <div className="panel-subtitle">
                {t('Use a local session until a cloud system is connected.')}
              </div>
            </div>
            <span className={`status-pill ${profile.signedIn ? 'success' : 'neutral'}`} style={{ textTransform: 'capitalize' }}>
              {profile.signedIn ? t('Active') : t('Offline')}
            </span>
          </div>

          <div style={{ padding: 24 }}>
            <div className="grid-2">
              <div>
                <label className="label" style={{ marginBottom: 12, display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  {t('Full name')}
                </label>
                <input
                  className="input"
                  value={draft.fullName}
                  onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="label" style={{ marginBottom: 12, display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  {t('Email Address')}
                </label>
                <input
                  className="input"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
              <button 
                className="btn btn-primary" 
                onClick={onSave} 
                disabled={!draft.fullName.trim() || !draft.email.trim()}
                style={{ paddingLeft: 20, paddingRight: 20, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Save size={16} />
                {t('Save Profile')}
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={onSignOut} 
                disabled={!profile.signedIn}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <LogOut size={16} />
                {t('Sign Out')}
              </button>
              <button 
                className="btn btn-danger" 
                onClick={handleDeleteClick} 
                disabled={!canDeleteAccount}
                style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: 'var(--accent-red)', color: 'white' }}
              >
                <Trash2 size={16} />
                {t('Delete Account')}
              </button>
            </div>
            <div
              style={{
                marginTop: 32,
                paddingTop: 24,
                borderTop: '1px solid var(--surface-border-faint)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Database size={16} />
                    {t('Account data')}
                  </div>
                  <div className="panel-subtitle">
                    {t('Export or restore manual transactions, accounts, watchlists and supported settings. API keys, AI analysis and market-price history are not restored.')}
                  </div>
                  <div className="panel-subtitle" style={{ marginTop: 6 }}>
                    {t('To transfer a Local Workspace, export it before signing in and import that file here. InvestAtlas never migrates browser data automatically.')}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={exportBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <Download size={16} />
                  {exportBusy ? t('Preparing export...') : t('Export account data')}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <Upload size={16} />
                  {importBusy ? t('Reading file...') : t('Import account data')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
                  style={{ display: 'none' }}
                />
              </div>

              {importMessage ? (
                <div
                  className="callout"
                  style={{
                    borderColor: importPlan?.conflicts.length ? 'var(--surface-warning-border)' : 'var(--surface-info-border)',
                    background: importPlan?.conflicts.length ? 'var(--surface-warning)' : 'var(--surface-info)',
                  }}
                >
                  {importMessage}
                </div>
              ) : null}

              {importPlan ? (
                <div style={{ padding: 16, background: 'var(--surface-soft)', border: '1px solid var(--surface-border-soft)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, marginBottom: 12 }}>
                    <FileCheck2 size={16} style={{ color: 'var(--green)' }} />
                    {t('Import preview')}
                  </div>
                  <div className="grid-2" style={{ gap: 10 }}>
                    <span className="status-pill neutral">{importPlan.summary.accounts} {t('accounts')}</span>
                    <span className="status-pill neutral">{importPlan.summary.transactions} {t('transactions')}</span>
                    <span className="status-pill neutral">{importPlan.summary.watchlists} {t('watchlists')}</span>
                    <span className="status-pill neutral">{importPlan.summary.budgetEntries} {t('budget entries')}</span>
                  </div>

                  {importPlan.conflicts.length > 0 ? (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 800, color: 'var(--yellow)', marginBottom: 8 }}>
                        {t('Conflicts found')}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflow: 'auto' }}>
                        {importPlan.conflicts.slice(0, 8).map((conflict, index) => (
                          <div key={`${conflict.type}-${conflict.incomingId}-${index}`} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {conflict.label} · {t(conflict.type)}
                          </div>
                        ))}
                        {importPlan.conflicts.length > 8 ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            +{importPlan.conflicts.length - 8} {t('more conflicts')}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                        {hasNonReplaceableImportConflict
                          ? t('Accounts that reuse an ID or label across different venues must be corrected before import.')
                          : t('Rename existing accounts first if you want to keep both versions. Otherwise replace conflicts.')}
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                    {importPlan.conflicts.length > 0 ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={importBusy}
                        onClick={() => {
                          window.location.href = '/accounts';
                        }}
                      >
                        {t('Rename existing accounts')}
                      </button>
                    ) : null}
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={importBusy || importPlan.conflicts.length > 0}
                      onClick={() => void handleApplyImport('append')}
                    >
                      {t('Import now')}
                    </button>
                    {importPlan.conflicts.length > 0 ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        disabled={importBusy || hasNonReplaceableImportConflict}
                        onClick={() => void handleApplyImport('replace-conflicts')}
                      >
                        {t('Replace conflicts')}
                      </button>
                    ) : null}
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={importBusy}
                      onClick={() => {
                        setImportPlan(null);
                        setImportMessage(null);
                      }}
                    >
                      {t('Cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
