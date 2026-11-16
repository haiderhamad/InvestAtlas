'use client';

import { useState } from 'react';
import {
  X,
  Search,
  LineChart,
  Database, // Proxy for precious metals
  Coins,
  Bitcoin,
  Home,
  Diamond
} from 'lucide-react';
import type { AssetClass } from '@/lib/config/supported-assets';
import Dialog from '@/components/ui/dialog';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';

type LedgerAssetClass = AssetClass | 'cash';

interface AddInvestmentModalProps {
  onClose: () => void;
  onSelectCategory: (assetClass: LedgerAssetClass) => void;
}

export default function AddInvestmentModal({ onClose, onSelectCategory }: AddInvestmentModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useAppTranslation();

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="add-investment-title"
      contentClassName="card"
      contentStyle={{
        width: '100%',
        maxWidth: 600,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        padding: 24,
        borderRadius: 16,
      }}
    >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ flex: 1 }} />
          <h2 id="add-investment-title" className="section-title" style={{ margin: 0, fontSize: 18 }}>Add Investment</h2>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <button 
              type="button" 
              className="btn-icon" 
              onClick={onClose} 
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: 24 }}>
          <Search 
            size={18} 
            style={{ 
              position: 'absolute', 
              left: 12, 
              top: '50%', 
              transform: 'translateY(-50%)', 
              color: 'var(--text-muted)' 
            }} 
          />
          <input
            type="text"
            className="input"
            placeholder="Securities, ISIN, WKN"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 38, width: '100%' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Securities */}
          <button 
            type="button"
            className="account-group-card account-row-link"
            style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onSelectCategory('stock')}
          >
            <div style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LineChart size={20} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{t('Securities')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Stocks, ETFs, Funds, Bonds, Derivatives</div>
            </div>
          </button>

          {/* Precious Metals */}
          <button 
            type="button"
            className="account-group-card account-row-link"
            style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onSelectCategory('metal')}
          >
            <div style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Database size={20} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{t('Precious Metals')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Gold, Silver...</div>
            </div>
          </button>

          {/* Foreign Currency */}
          <button 
            type="button"
            className="account-group-card account-row-link"
            style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onSelectCategory('cash')}
          >
            <div style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Coins size={20} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Foreign Currency</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>USD, CHF, GBP...</div>
            </div>
          </button>

          {/* Crypto */}
          <button 
            type="button"
            className="account-group-card account-row-link"
            style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onSelectCategory('crypto')}
          >
            <div style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bitcoin size={20} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Crypto</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Bitcoin, Ethereum, Doge...</div>
            </div>
          </button>

          {/* Real Estate */}
          <button 
            type="button"
            className="account-group-card"
            style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, background: 'transparent', textAlign: 'left', cursor: 'not-allowed', opacity: 0.5 }}
            disabled
          >
            <div style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Home size={20} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Real Estate</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Coming soon</div>
            </div>
          </button>

          {/* Other */}
          <button 
            type="button"
            className="account-group-card"
            style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 12, background: 'transparent', textAlign: 'left', cursor: 'not-allowed', opacity: 0.5 }}
            disabled
          >
            <div style={{ background: 'var(--bg-page)', padding: 10, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Diamond size={20} style={{ color: 'var(--text-primary)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Other</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Coming soon</div>
            </div>
          </button>
        </div>
    </Dialog>
  );
}
