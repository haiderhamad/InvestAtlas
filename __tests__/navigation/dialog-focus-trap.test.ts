/** @jest-environment jsdom */

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Dialog from '@/components/ui/dialog';

describe('shared dialog keyboard focus containment', () => {
  let oldRaf: typeof window.requestAnimationFrame;
  let oldCancel: typeof window.cancelAnimationFrame;

  beforeAll(() => {
    oldRaf = window.requestAnimationFrame;
    oldCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  afterAll(() => {
    window.requestAnimationFrame = oldRaf;
    window.cancelAnimationFrame = oldCancel;
  });

  function mount() {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);
    outside.focus();
    const onClose = jest.fn();
    const result = render(
      createElement(
        Dialog,
        {
          open: true,
          onClose,
          labelledBy: 'test-dialog-label',
          children: createElement(
            'div',
            null,
            createElement('h2', { id: 'test-dialog-label' }, 'Dialog title'),
            createElement('button', { type: 'button' }, 'First'),
            createElement('button', { type: 'button' }, 'Last'),
          ),
        },
      ),
    );
    return { ...result, onClose, outside };
  }

  it('returns forward Tab focus inside an open dialog when focus has escaped outside', () => {
    const { outside } = mount();
    const first = screen.getByRole('button', { name: 'First' });
    outside.focus();
    expect(document.activeElement).toBe(outside);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    outside.remove();
  });

  it('returns reverse Tab from outside to the last dialog control', () => {
    const { outside } = mount();
    const last = screen.getByRole('button', { name: 'Last' });
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    outside.remove();
  });

  it('traps forward Tab from the last control to the first control', () => {
    const { outside } = mount();
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    outside.remove();
  });
});
