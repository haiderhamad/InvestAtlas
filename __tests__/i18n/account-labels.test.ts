import { translateAppText } from '@/lib/i18n/app-localization';

describe('account action localization', () => {
  it('does not leak German account action labels into English', () => {
    expect(
      translateAppText('Investment-Cash Konto anlegen', 'en'),
    ).toBe('Create Investment-Cash account');
    expect(
      translateAppText('Saving Cash / Sparkonto anlegen', 'en'),
    ).toBe('Create Saving Cash account');
    expect(
      translateAppText('Saving Cash / Sparkonto', 'en'),
    ).toBe('Saving Cash');
    expect(
      translateAppText('Archivieren / Löschen', 'en'),
    ).toBe('Archive / Delete');
    expect(
      translateAppText('Endgültig löschen', 'en'),
    ).toBe('Delete permanently');
  });

  it('keeps Arabic account actions translated', () => {
    expect(
      translateAppText('Investment-Cash Konto anlegen', 'ar'),
    ).not.toContain('anlegen');
    expect(
      translateAppText('Saving Cash / Sparkonto anlegen', 'ar'),
    ).not.toContain('Sparkonto');
    expect(
      translateAppText('Archivieren / Löschen', 'ar'),
    ).not.toContain('Löschen');
  });
});
