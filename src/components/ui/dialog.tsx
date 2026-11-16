'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DialogProps {
  id?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export default function Dialog({
  id,
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = 'account-create-overlay',
  contentClassName = 'account-create-modal',
  contentStyle,
  initialFocusRef,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const focusInitial = () => {
      const target =
        initialFocusRef?.current ??
        contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        contentRef.current;
      target?.focus();
    };
    const rafId = window.requestAnimationFrame(focusInitial);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.cancelAnimationFrame(rafId);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !contentRef.current) return;

      const focusable = Array.from(
        contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('aria-hidden'));

      if (focusable.length === 0) {
        event.preventDefault();
        contentRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !contentRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !contentRef.current.contains(active)) {
        // Programmatic focus can escape a modal; forward Tab must re-enter it.
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  return (
    <div
      id={id}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={contentRef}
        className={contentClassName}
        style={contentStyle}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
