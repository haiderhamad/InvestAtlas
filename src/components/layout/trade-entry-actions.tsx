'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AssetClass } from '@/lib/config/supported-assets';
import { ANONYMOUS_WORKSPACE_MODE_EVENT, readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { BROWSER_WORKSPACE_CHANGE_EVENT, getActiveBrowserWorkspaceUserId } from '@/lib/storage/workspace-storage';
import GlobalAddModal from '@/components/layout/global-add-modal';

type TradeSide = 'buy' | 'sell';
type TradeContext = { venue?: string; asset?: string; assetClass?: AssetClass };
type LaunchTrade = (side: TradeSide, invoker: HTMLButtonElement, context?: TradeContext) => void;

export function getTradeWorkspaceKey() {
  const userId = getActiveBrowserWorkspaceUserId();
  if (userId === undefined) return 'pending';
  return userId === null ? readAnonymousWorkspaceMode() : `cloud:${userId}`;
}

function subscribeWorkspace(update: () => void) {
  const events = [BROWSER_WORKSPACE_CHANGE_EVENT, ANONYMOUS_WORKSPACE_MODE_EVENT, 'storage'];
  events.forEach(event => window.addEventListener(event, update));
  return () => events.forEach(event => window.removeEventListener(event, update));
}

export function useTradeEntry() {
  const workspace = useSyncExternalStore(subscribeWorkspace, getTradeWorkspaceKey, () => 'pending');
  const [entry, setEntry] = useState<(TradeContext & { side: TradeSide; workspace: string }) | null>(null);
  const returnFocusRef = useRef<HTMLElement>(null);
  const isDemo = workspace === 'demo_snapshot';
  const canEdit = workspace !== 'pending' && !isDemo;

  useEffect(() => {
    setEntry(current => current?.workspace === workspace ? current : null);
  }, [workspace]);

  const launchTrade: LaunchTrade = (side, invoker, context) => {
    if (!canEdit || getTradeWorkspaceKey() !== workspace) return;
    returnFocusRef.current = invoker;
    setEntry({ ...context, side, workspace });
  };

  const dialog = canEdit && entry?.workspace === workspace ? (
    <GlobalAddModal
      onClose={() => setEntry(null)}
      initialType={entry.side}
      initialVenue={entry.venue}
      initialAsset={entry.asset}
      initialAssetClass={entry.assetClass}
      returnFocusRef={returnFocusRef}
    />
  ) : null;

  return { canEdit, isDemo, workspace, launchTrade, dialog };
}

export function TradeEntryActions({ launchTrade, context, compact }: {
  launchTrade: LaunchTrade;
  context?: TradeContext;
  compact?: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      <button
        type="button"
        className={compact ? 'btn btn-secondary btn-sm' : 'btn btn-primary trade-action-primary'}
        onClick={event => launchTrade('buy', event.currentTarget, context)}
      >
        <ArrowDownLeft size={16} aria-hidden="true" />
        {t('Record buy')}
      </button>
      <button
        type="button"
        className={compact ? 'btn btn-secondary btn-sm' : 'btn btn-secondary'}
        onClick={event => launchTrade('sell', event.currentTarget, context)}
      >
        <ArrowUpRight size={16} aria-hidden="true" />
        {t('Record sell')}
      </button>
    </>
  );
}
