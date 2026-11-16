/** @jest-environment jsdom */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sidebar from '@/components/layout/sidebar';

jest.mock('@/lib/runtime/deployment-mode', () => ({
  INVESTATLAS_DEPLOYMENT_MODE: 'public_demo',
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: {
    children: unknown; href: string; [key: string]: unknown;
  }) => require('react').createElement('a', { href, ...props }, children),
}));

jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ t: (value: string) => value }),
}));

const anonymousProfile = { signedIn: false, fullName: '', email: '' };

describe('Operator Demo (Option A) sidebar account menu', () => {
  afterEach(cleanup);

  it.each([false, true])('hides sign-in in the %s collapsed state', (isCollapsed) => {
    render(createElement(Sidebar, {
      accountProfile: anonymousProfile,
      anonymousWorkspaceMode: 'demo_snapshot',
      isCollapsed,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });
});
