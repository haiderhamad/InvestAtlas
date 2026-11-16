/** @jest-environment jsdom */

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import GeneralPreferences from '@/components/settings/general-preferences';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    require('react').createElement('a', { href, ...props }, children),
}));

// Deliberately simulate a locale in which generic app labels are translated;
// native language names in the selector must remain stable.
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (value: string) => `localized:${value}` }),
}));

describe('GeneralPreferences native-language selector', () => {
  afterEach(cleanup);

  it('keeps EN/DE/AR options self-identifying and keyboard-accessible', () => {
    const setLanguage = jest.fn();
    const props = {
      theme: 'dark' as const,
      setTheme: jest.fn(),
      language: 'ar' as const,
      setLanguage,
      currency: 'eur' as const,
      setCurrency: jest.fn(),
    };

    render(createElement(GeneralPreferences, props));
    expect(screen.getByRole('button', { name: 'localized:Dark', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'localized:Light', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: /localized:.*EUR/, pressed: true })).toBeTruthy();
    const english = screen.getByRole('button', { name: 'English' });
    const german = screen.getByRole('button', { name: 'Deutsch' });
    const arabic = screen.getByRole('button', { name: 'العربية' });

    expect(english.getAttribute('lang')).toBe('en');
    expect(german.getAttribute('lang')).toBe('de');
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
    expect(english.getAttribute('aria-pressed')).toBe('false');
    expect(german.getAttribute('aria-pressed')).toBe('false');
    expect(arabic.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(german);
    expect(setLanguage).toHaveBeenCalledWith('de');
  });
});
