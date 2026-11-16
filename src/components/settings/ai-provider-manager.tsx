'use client';

import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { Brain, Plus, Trash2, Edit2, CheckCircle, AlertTriangle, XCircle, Play, Save, ShieldCheck, X } from 'lucide-react';
import type { ProviderConfig, ProviderTestResult, ProviderType } from '@/lib/ai/provider-registry';
import {
  buildProviderMutationPayload,
  requireSuccessfulProviderResponse,
  type ProviderMutationForm,
} from '@/lib/ai/provider-client';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { getFirebaseAuthHeaders } from '@/lib/auth/firebase-api-auth';

// Ensure the component handles the masked keys gracefully.

type ProviderForm = ProviderMutationForm & Pick<Partial<ProviderConfig>, 'id'>;
type ProviderListItem = Omit<ProviderConfig, 'apiKey'> & {
  apiKey?: string;
  maskedKey?: string;
};

interface ProviderEditorProps {
  form: ProviderForm;
  setForm: Dispatch<SetStateAction<ProviderForm>>;
  onSave: () => void;
  onCancel: () => void;
  onTest: () => void | Promise<void>;
  isTesting: boolean;
  testResult?: ProviderTestResult;
}

export function AIProviderManager() {
  const { t, language } = useAppTranslation();
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProviderForm>({});

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, ProviderTestResult>>({});

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/ai/providers', {
        headers: await getFirebaseAuthHeaders(),
      });
      if (!res.ok) throw new Error(t('Failed to load providers'));
      const data = await res.json();
      setProviders(data.providers || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    const newId = 'new_' + Date.now();
    setEditForm({
      id: newId,
      name: t('New Provider'),
      type: 'openrouter',
      apiKey: '',
      model: '',
      orgId: '',
      enabled: true,
      priority: providers.length,
    });
    setEditingId(newId);
  };

  const handleEdit = (p: ProviderListItem) => {
    setEditForm({
      id: p.id,
      name: p.name,
      type: p.type,
      apiKey: '',
      model: p.model,
      orgId: p.orgId,
      enabled: p.enabled,
      priority: p.priority,
      notes: p.notes,
    }); // Don't put masked key or a legacy/custom endpoint in the form.
    setEditingId(p.id);
  };

  const handleSave = async (id: string) => {
    try {
      const isNew = id.startsWith('new_');
      const url = '/api/ai/providers';
      const method = isNew ? 'POST' : 'PUT';
      
      const payload = buildProviderMutationPayload(editForm, {
        id: isNew ? undefined : id,
        omitEmptyApiKey: !isNew,
      });

      const res = await fetch(url, {
        method,
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      await requireSuccessfulProviderResponse(res, t('Failed to save'));

      await fetchProviders();
      setEditingId(null);
      setEditForm({});
    } catch (err) {
      alert(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('Delete provider? This cannot be undone.'))) return;
    try {
      const res = await fetch(`/api/ai/providers?id=${id}`, {
        method: 'DELETE',
        headers: await getFirebaseAuthHeaders(),
      });
      await requireSuccessfulProviderResponse(res, t('Failed to delete provider'));
      await fetchProviders();
    } catch (err) {
      alert(String(err));
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      setProviders(prev => prev.map(p => p.id === id ? { ...p, enabled } : p));
      const res = await fetch('/api/ai/providers', {
        method: 'PUT',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, enabled }),
      });
      await requireSuccessfulProviderResponse(res, t('Failed to toggle provider'));
    } catch {
      alert(t('Failed to toggle provider'));
      await fetchProviders(); // Revert
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const p = providers.find(x => x.id === id);
      if (!p) throw new Error(t('Provider not found'));

      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: p.id }), // Test stored config
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed');

      setTestResult(prev => ({ ...prev, [id]: data.result }));
      await fetchProviders(); // Reload to get updated lastTestAt and detectedModels
    } catch (err) {
      setTestResult(prev => ({ 
        ...prev, 
        [id]: { status: 'error', provider: t('Unknown'), type: 'openai', models: [], latencyMs: 0, message: String(err) } 
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleTestUnsaved = async () => {
    setTestingId('unsaved');
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(buildProviderMutationPayload(editForm)),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed');

      setTestResult(prev => ({ ...prev, 'unsaved': data.result }));
      if (data.result.models && data.result.models.length > 0 && !editForm.model) {
        setEditForm(prev => ({ ...prev, model: data.result.defaultModel || data.result.models[0] }));
      }
    } catch (err) {
      setTestResult(prev => ({ 
        ...prev, 
        'unsaved': { status: 'error', provider: t('Unknown'), type: 'openai', models: [], latencyMs: 0, message: String(err) } 
      }));
    } finally {
      setTestingId(null);
    }
  };

  const moveProvider = async (index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= providers.length) return;
    const newProv = [...providers];
    const temp = newProv[index];
    newProv[index] = newProv[index + direction];
    newProv[index + direction] = temp;
    setProviders(newProv);

    try {
      const reorderIds = newProv.map(p => p.id);
      const res = await fetch('/api/ai/providers', {
        method: 'PUT',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reorder: reorderIds }),
      });
      await requireSuccessfulProviderResponse(res, t('Failed to reorder providers'));
    } catch {
      alert(t('Failed to reorder providers'));
      await fetchProviders();
    }
  };

  if (loading && providers.length === 0) return <div className="text-center p-8">{t('Loading AI Providers...')}</div>;

  return (
    <div className="card">
      <div className="section-header" style={{ marginBottom: 20 }}>
        <span className="section-title">
          <Brain size={18} style={{ display: 'inline', marginInlineEnd: 8 }} />
          {t('Personal AI keys for document import')}
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleAdd} disabled={editingId !== null}>
          <Plus size={14} /> {t('Add personal AI key')}
        </button>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        {t('Use your own API key for the reviewed document and transaction import. Keys are encrypted server-side. Each upload uses only the highest-priority enabled service and is never forwarded automatically to a fallback provider.')}
        <div className="ai-provider-boundary-note">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>{t('Supported services are OpenRouter, Groq, Google Gemini, and OpenAI. You can still enter any model ID available through your selected service; OpenRouter can provide access to models from many vendors. Custom endpoint URLs remain disabled so keys are sent only to fixed official hosts.')}</span>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'var(--red-dim)', color: 'var(--red)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {providers.length === 0 && editingId === null && (
          <div style={{ textAlign: 'center', padding: 32, background: 'var(--bg-primary)', borderRadius: 8, border: '1px dashed var(--border)' }}>
            <Brain size={32} style={{ color: 'var(--text-muted)', margin: '0 auto 12px' }} />
            <div style={{ color: 'var(--text-secondary)' }}>{t('No personal AI keys configured')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('Add a personal AI key only for the reviewed document and transaction import. Technical analysis remains deterministic and does not use this key.')}</div>
          </div>
        )}

        {providers.map((p, index) => (
          editingId === p.id ? (
            <ProviderEditor 
              key={p.id} 
              form={editForm} 
              setForm={setEditForm} 
              onSave={() => handleSave(p.id)} 
              onCancel={() => { setEditingId(null); setEditForm({}); }} 
              onTest={handleTestUnsaved}
              isTesting={testingId === 'unsaved'}
              testResult={testResult['unsaved']}
              t={t}
            />
          ) : (
            <div key={p.id} className="card" style={{ background: 'var(--bg-primary)', padding: 16, border: !p.enabled ? '1px solid var(--border)' : '1px solid var(--accent-teal)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    <button type="button" className="btn btn-secondary ai-provider-icon-button" onClick={() => moveProvider(index, -1)} disabled={index === 0} aria-label={t('Move provider up')}>↑</button>
                    <button type="button" className="btn btn-secondary ai-provider-icon-button" onClick={() => moveProvider(index, 1)} disabled={index === providers.length - 1} aria-label={t('Move provider down')}>↓</button>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span dir="auto" style={{ fontWeight: 700, fontSize: 16, color: !p.enabled ? 'var(--text-muted)' : 'inherit' }}>{p.name}</span>
                      <span className="badge badge-teal">{p.type}</span>
                      {!p.enabled && <span className="badge badge-yellow">{t('Disabled')}</span>}
                      {index === 0 && p.enabled && <span className="badge badge-green">{t('Primary')}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div className="mono">{t('Key')}: <bdi dir="ltr">{p.maskedKey}</bdi></div>
                      {p.model && <div>{t('Default model')}: <bdi dir="ltr" className="mono bg-secondary px-1 rounded">{p.model}</bdi></div>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginInlineEnd: 12 }}>
                    <input type="checkbox" checked={p.enabled} onChange={(e) => handleToggle(p.id, e.target.checked)} />
                    {t('Enabled')}
                  </label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleTest(p.id)} disabled={testingId === p.id}>
                    <Play size={14} /> {testingId === p.id ? t('Testing...') : t('Test')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleEdit(p)}>
                    <Edit2 size={14} /> {t('Edit')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm ai-provider-icon-button" style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }} onClick={() => handleDelete(p.id)} aria-label={`${t('Delete')} ${p.name}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Status Display */}
              {(p.lastTestStatus || testResult[p.id]) && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {testResult[p.id] ? (
                    <TestResultDisplay result={testResult[p.id]} t={t} />
                  ) : p.lastTestStatus ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      {p.lastTestStatus === 'ok' ? <CheckCircle size={16} style={{ color: 'var(--green)' }} /> : 
                       p.lastTestStatus === 'rate_limit' ? <AlertTriangle size={16} style={{ color: 'var(--yellow)' }} /> :
                       <XCircle size={16} style={{ color: 'var(--red)' }} />}
                       <span style={{ color: p.lastTestStatus === 'ok' ? 'var(--green)' : p.lastTestStatus === 'rate_limit' ? 'var(--yellow)' : 'var(--red)' }}>
                         {t(p.lastTestStatus === 'ok'
                           ? 'Connected'
                           : p.lastTestStatus === 'rate_limit'
                             ? 'Rate limit reached'
                             : 'Provider temporarily unavailable')}
                       </span>
                      <span style={{ color: 'var(--text-muted)' }}>— {t('Last tested')}: {new Date(p.lastTestAt!).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US')}</span>
                    </div>
                  ) : null}
                  {p.detectedModels && p.detectedModels.length > 0 && !testResult[p.id] && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('Detected models')} ({p.detectedModels.length}): {p.detectedModels.slice(0, 5).join(', ')}{p.detectedModels.length > 5 ? '...' : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ))}

        {editingId?.startsWith('new_') && (
          <ProviderEditor 
            form={editForm} 
            setForm={setEditForm} 
            onSave={() => handleSave(editingId)} 
            onCancel={() => { setEditingId(null); setEditForm({}); }} 
            onTest={handleTestUnsaved}
            isTesting={testingId === 'unsaved'}
            testResult={testResult['unsaved']}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

interface ProviderEditorProps {
  form: ProviderForm;
  setForm: Dispatch<SetStateAction<ProviderForm>>;
  onSave: () => void;
  onCancel: () => void;
  onTest: () => void | Promise<void>;
  isTesting: boolean;
  testResult?: ProviderTestResult;
  t: (key: string) => string;
}

function ProviderEditor({ form, setForm, onSave, onCancel, onTest, isTesting, testResult, t }: ProviderEditorProps) {
  return (
    <div className="card" style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent-blue)', padding: 20 }}>
      <h3 className="section-title" style={{ marginBottom: 16 }}>{form.id?.startsWith('new_') ? t('Connect personal AI provider') : t('Edit provider')}</h3>
      
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div>
          <label className="label" htmlFor="ai-provider-name">{t('Connection name')}</label>
          <input id="ai-provider-name" className="input" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('e.g. My OpenRouter account')} />
        </div>
        <div>
          <label className="label" htmlFor="ai-provider-service">{t('Supported AI service')}</label>
          <select id="ai-provider-service" className="select" value={form.type || 'openrouter'} onChange={e => setForm({ ...form, type: e.target.value as ProviderType })}>
            <option value="openrouter">{t('OpenRouter')}</option>
            <option value="groq">{t('Groq')}</option>
            <option value="gemini">{t('Google Gemini')}</option>
            <option value="openai">{t('OpenAI')}</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="label" htmlFor="ai-provider-api-key">{t('API key')} {form.id && !form.id.startsWith('new_') && <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({t('leave blank to keep the current key')})</span>}</label>
        <input id="ai-provider-api-key" className="input" type="password" dir="ltr" autoComplete="off" value={form.apiKey || ''} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={t('Paste the API key from the selected service')} />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div>
          <label className="label" htmlFor="ai-provider-model">{t('Default model')} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({t('optional, can be detected automatically via "Test"')})</span></label>
          <input id="ai-provider-model" className="input mono" dir="ltr" autoCapitalize="none" spellCheck={false} value={form.model || ''} onChange={e => setForm({ ...form, model: e.target.value })} placeholder={t('e.g. openrouter/auto, gemini-pro, llama-3.1-70b...')} />
          <div className="field-hint">{t('A custom server URL or port is not accepted on hosted InvestAtlas because it could expose your key or private network. Choose a supported service and enter its model ID instead.')}</div>
        </div>
        <div>
          <label className="label" htmlFor="ai-provider-organization">{t('Organization ID / Project ID')} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>({t('optional')})</span></label>
          <input id="ai-provider-organization" className="input" dir="ltr" value={form.orgId || ''} onChange={e => setForm({ ...form, orgId: e.target.value })} placeholder={t('For OpenAI projects where required')} />
        </div>
      </div>

      {testResult && (
        <div style={{ marginBottom: 16, padding: 16, background: 'var(--bg-background)', borderRadius: 8 }}>
          <TestResultDisplay result={testResult} t={t} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={onTest} disabled={isTesting || (!form.apiKey && (!form.id || form.id.startsWith('new_')))}>
          <Play size={16} /> {isTesting ? t('Testing connection & models...') : t('Test connection & key')}
        </button>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            <X size={16} /> {t('Cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!form.name || (!form.apiKey && (!form.id || form.id.startsWith('new_')))}>
            <Save size={16} /> {t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TestResultDisplay({ result, t }: { result: ProviderTestResult, t: (key: string) => string }) {
  const isOk = result.status === 'ok';
  const statusLabel: Record<ProviderTestResult['status'], string> = {
    ok: 'Connected',
    error: 'Provider returned an unexpected response',
    rate_limit: 'Rate limit reached',
    unreachable: 'Provider temporarily unavailable',
    invalid_key: 'Invalid API key',
  };
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isOk ? <CheckCircle size={16} style={{ color: 'var(--green)' }} /> : <XCircle size={16} style={{ color: 'var(--red)' }} />}
        <strong style={{ color: isOk ? 'var(--green)' : 'var(--red)' }}>{t('Status')}: {t(statusLabel[result.status])}</strong>
        <bdi dir="ltr" style={{ color: 'var(--text-muted)' }}>({result.latencyMs} ms)</bdi>
      </div>
      {result.provider && <div><strong>{t('Detected Provider')}:</strong> <bdi>{result.provider}</bdi></div>}
      {result.baseUrl && <div><strong>{t('Detected Endpoint')}:</strong> <bdi dir="ltr" className="mono">{result.baseUrl}</bdi></div>}
      {result.models && result.models.length > 0 && (
        <div>
          <strong>{t('Available Models')} ({result.models.length}):</strong> 
          <bdi dir="ltr" className="mono" style={{ color: 'var(--text-secondary)', marginInlineStart: 8 }}>
            {result.models.slice(0, 8).join(', ')}{result.models.length > 8 ? '...' : ''}
          </bdi>
        </div>
      )}
    </div>
  );
}
