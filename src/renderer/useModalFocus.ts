import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalFocusOptions {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusSelector?: string;
  fallbackFocus?: () => HTMLElement | null;
}

/**
 * Keeps keyboard focus inside a modal surface, supports Escape, and returns
 * focus to the opener when the modal closes. If an action deliberately moves
 * focus elsewhere while closing, that newer focus target wins.
 */
export function useModalFocus({
  open,
  containerRef,
  onClose,
  initialFocusSelector,
  fallbackFocus,
}: ModalFocusOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackFocusRef = useRef(fallbackFocus);
  fallbackFocusRef.current = fallbackFocus;

  useEffect(() => {
    if (!open) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;
    const fallbackFocusAtOpen = fallbackFocusRef.current;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const isTopmostModal = () => {
      const modals = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
      return modals.length === 0 || modals[modals.length - 1] === container;
    };

    const focusInitial = () => {
      if (!isTopmostModal()) return;
      const preferred = initialFocusSelector
        ? container.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      const target = preferred ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      target?.focus();
    };
    const focusFrame = requestAnimationFrame(focusInitial);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostModal()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);

      requestAnimationFrame(() => {
        const active = document.activeElement;
        const focusIsUnclaimed = active === null ||
          active === document.body ||
          active === container ||
          (active instanceof HTMLElement && !active.isConnected);
        const restoreTarget = previousFocus?.isConnected
          ? previousFocus
          : fallbackFocusAtOpen?.();
        if (
          restoreTarget?.isConnected &&
          focusIsUnclaimed &&
          document.activeElement === active
        ) {
          restoreTarget.focus();
        }
      });
    };
  }, [containerRef, initialFocusSelector, open]);
}
