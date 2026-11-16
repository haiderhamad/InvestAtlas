/** @jest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import LocalizationEffects from '@/components/layout/localization-effects';

afterEach(cleanup);

it('preserves native language names and opted-out attributes while localizing ordinary UI', () => {
  const { rerender } = render(<>
    <LocalizationEffects language="ar" />
    <button lang="en" translate="no"><span>English</span></button>
    <input translate="no" aria-label="English" placeholder="English" />
    <p>Settings</p>
  </>);
  expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'English' }).getAttribute('placeholder')).toBe('English');
  expect(screen.getByText('الإعدادات')).toBeTruthy();
  rerender(<>
    <LocalizationEffects language="de" />
    <button lang="en" translate="no"><span>English</span></button>
    <input translate="no" aria-label="English" placeholder="English" />
    <p>Settings</p>
  </>);
  expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
  expect(screen.getByText('Einstellungen')).toBeTruthy();
});
