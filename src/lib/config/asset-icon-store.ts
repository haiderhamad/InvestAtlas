import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

export const ASSET_ICONS_STORAGE_KEY = 'investatlas.asset-icons';
export const ASSET_ICONS_EVENT = 'investatlas.asset-icons-updated';

/**
 * Reads the icon map from localStorage.
 * Historical format: { "BTC": "https://...", "AAPL": "https://..." }.
 * Retained for data-export compatibility; UI no longer renders arbitrary saved image URLs.
 */
export function readAssetIcons(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = readWorkspaceStorageItem(ASSET_ICONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Writes the icon map to localStorage.
 */
export function writeAssetIcons(icons: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    if (writeWorkspaceStorageItem(ASSET_ICONS_STORAGE_KEY, JSON.stringify(icons))) {
      window.dispatchEvent(new Event(ASSET_ICONS_EVENT));
    }
  } catch (err) {
    console.error('Failed to write asset icons', err);
  }
}

/**
 * Updates a single icon and saves.
 */
export function saveAssetIcon(symbol: string, url: string) {
  if (!url) return;
  const icons = readAssetIcons();
  if (icons[symbol] === url) return; // No change
  
  icons[symbol] = url;
  writeAssetIcons(icons);
}

/**
 * Updates multiple icons and saves.
 */
export function saveAssetIcons(newIcons: Record<string, string>) {
  const icons = readAssetIcons();
  let changed = false;
  
  for (const [symbol, url] of Object.entries(newIcons)) {
    if (url && icons[symbol] !== url) {
      icons[symbol] = url;
      changed = true;
    }
  }
  
  if (changed) {
    writeAssetIcons(icons);
  }
}
