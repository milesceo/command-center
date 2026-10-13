import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * For modal surfaces: keeps Tab inside `container`, and gives focus back to whatever had it
 * before the surface opened. Initial focus is left to the surface (autoFocus or a ref), but
 * falls back to the first focusable element.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const root = container.current;
    if (!active || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const here = document.activeElement;
      if (e.shiftKey && (here === first || !root.contains(here))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (here === last || !root.contains(here))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // The opener may have been removed (a deleted row); then there is nothing to return to.
      if (previous?.isConnected) previous.focus();
    };
  }, [container, active]);
}
