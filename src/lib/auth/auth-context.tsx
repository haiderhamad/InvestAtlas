'use client';

import { Fragment, createContext, useContext, useEffect, useState } from 'react';
import { db, type DbUser, type DbSession } from '@/lib/db';
import {
  markBrowserWorkspacePending,
  resolveBrowserWorkspace,
} from '@/lib/storage/workspace-storage';
import { reportCloudDataUnavailable, setCloudDataWorkspace } from '@/lib/storage/cloud-data-status';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { clearTwelve, reconcileTwelve } from '@/lib/financial-data/providers/twelve-personal';
import { clearPublicSourceConsent, reconcilePublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { clearYahooPersonalCache } from '@/lib/financial-data/providers/yahoo-personal';
import { clearMarketData, reconcileMarketData } from '@/lib/financial-data/providers/marketdata-personal';
import { clearEodhd, reconcileEodhd } from '@/lib/financial-data/providers/eodhd-personal';
import { clearYahooPersonalDiscoverySession } from '@/lib/financial-data/providers/yahoo-personal-discovery';
import { clearLocalAIConfig } from '@/lib/ai/local-browser-provider';
import { ANONYMOUS_WORKSPACE_MODE_EVENT, readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import {
  clearAlphaVantageSessionCredential,
  reconcileAlphaVantageCredentialOwner,
} from '@/lib/financial-data/providers/alpha-vantage-browser';
import { clearTiingoBrowserCredential, reconcileTiingoBrowserCredentialOwner } from '@/lib/financial-data/providers/tiingo-browser';

interface AuthContextValue {
  user: DbUser | null;
  session: DbSession | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DbUser | null>(null);
  const [session, setSession] = useState<DbSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal') return;
    const clearKeysWhenEnteringDemo = () => {
      if (readAnonymousWorkspaceMode() !== 'demo_snapshot') return;
      clearTiingoBrowserCredential();
      clearTwelve();
      clearPublicSourceConsent();
      clearYahooPersonalCache();
      clearYahooPersonalDiscoverySession();
      clearMarketData();
      clearEodhd();
      clearLocalAIConfig();
    };
    window.addEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, clearKeysWhenEnteringDemo);
    return () => window.removeEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, clearKeysWhenEnteringDemo);
  }, []);

  useEffect(() => {
    markBrowserWorkspacePending();

    // Skip if DB is not configured (development without credentials)
    if (!db.isConfigured()) {
      resolveBrowserWorkspace(null);
      setCloudDataWorkspace(null);
      setTimeout(() => setLoading(false), 0);
      return;
    }

    // Firebase's first auth-state callback fires after persisted credentials
    // have been restored. Mounting the app before that callback would let a
    // signed-in session briefly read the anonymous Local Workspace.
    const unsubscribe = db.onAuthStateChange((nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null;
      reconcileAlphaVantageCredentialOwner(nextUserId);
      reconcileTiingoBrowserCredentialOwner(nextUserId);
      reconcileTwelve(nextUserId);
      reconcilePublicSourceConsent(nextUserId);
      reconcileMarketData(nextUserId);
      reconcileEodhd(nextUserId);
      setCloudDataWorkspace(nextUserId);
      if (nextUserId) {
        // Every signed-in route waits for these stores' Firebase snapshots, including direct links.
        void import('@/lib/transactions/manual-store')
          .catch(error => reportCloudDataUnavailable('transactions', nextUserId, error));
        void import('@/lib/accounts/manual-accounts-store')
          .catch(error => reportCloudDataUnavailable('accounts', nextUserId, error));
        void import('@/lib/config/asset-risk-store')
          .catch(error => reportCloudDataUnavailable('asset_risks', nextUserId, error));
      }
      resolveBrowserWorkspace(nextUserId);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const signOut = async () => {
    clearAlphaVantageSessionCredential();
    clearTiingoBrowserCredential();
    clearTwelve();
    clearPublicSourceConsent();
    clearMarketData();
    clearEodhd();
    clearYahooPersonalDiscoverySession();
    clearYahooPersonalCache();
    clearLocalAIConfig();
    await db.signOut();
    resolveBrowserWorkspace(null);
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {loading ? null : (
        <Fragment key={user?.id ? `user:${user.id}` : 'local-workspace'}>
          {children}
        </Fragment>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
