/** @jest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { writeAppPreferences } from '@/lib/preferences/app-preferences';
import { markBrowserWorkspacePending, resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

describe('useAppTranslation callback stability', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    markBrowserWorkspacePending();
  });

  it('keeps the callback stable until the selected language changes', async () => {
    window.localStorage.clear();
    resolveBrowserWorkspace(null);
    const view = renderHook(() => useAppTranslation());
    await waitFor(() => expect(view.result.current.language).toBe('en'));

    const englishTranslator = view.result.current.t;
    view.rerender();
    expect(view.result.current.t).toBe(englishTranslator);

    act(() => writeAppPreferences({ language: 'de' }));
    await waitFor(() => expect(view.result.current.language).toBe('de'));
    expect(view.result.current.t).not.toBe(englishTranslator);
  });
});
