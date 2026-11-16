/** @jest-environment jsdom */

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Sidebar from '@/components/layout/sidebar';

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
  useAppTranslation: () => ({
    t: (value: string) => value,
  }),
}));

const profile = { signedIn: false, fullName: '', email: '' };

describe('sidebar keyboard and screen-reader controls', () => {
  afterEach(cleanup);

  it('has an accessible name for expanded and collapsed sidebar toggles', () => {
    const props = { accountProfile: profile, toggleSidebar: jest.fn() };
    const view = render(createElement(Sidebar, { ...props, isCollapsed: false }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    view.rerender(createElement(Sidebar, { ...props, isCollapsed: true }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('closes the expanded account menu with Escape and restores focus to its trigger', () => {
    render(createElement(Sidebar, { accountProfile: profile, isCollapsed: false }));
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the collapsed account menu with Escape and restores focus to its trigger', () => {
    render(createElement(Sidebar, { accountProfile: profile, isCollapsed: true }));
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });
});

it('announces the current desktop navigation destination', () => {
  render(createElement(Sidebar, { accountProfile: profile, isCollapsed: false }));
  expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Portfolio' }).hasAttribute('aria-current')).toBe(false);
});
