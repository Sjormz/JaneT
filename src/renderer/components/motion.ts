import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

// Motion tokens for WAAPI, mirroring the --dur-* and --ease-* custom properties in styles/tokens.css.
export const DURATION = { instant: 90, quick: 160, base: 240, slow: 360 } as const;

export const EASING = {
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  spring: 'linear(0, 0.25 8%, 0.62 18%, 0.9 30%, 1.015 44%, 1.02 52%, 1.005 70%, 1)',
} as const;

/** Exits are quicker than entrances so dismissed UI gets out of the way. */
export const exitDuration = (enter: number) => Math.round(enter * 0.65);

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Glides a selection highlight between items in a list (sidebar rows, tool rail, segmented controls, palette).
 * The selected item keeps its own static background, so state is always correct and measurable; during a
 * change a ghost copy of that background moves from the previous item to the new one, then hands over.
 */
export function glideSelection(container: HTMLElement, from: HTMLElement | null, to: HTMLElement | null): void {
  if (!from || !to || from === to || !from.isConnected || prefersReducedMotion() || typeof to.animate !== 'function') return;
  const origin = container.getBoundingClientRect();
  const start = from.getBoundingClientRect();
  const end = to.getBoundingClientRect();
  if (!start.width || !end.width) return;
  const style = getComputedStyle(to);
  const ghost = document.createElement('span');
  ghost.className = 'selection-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: `${end.left - origin.left + container.scrollLeft}px`,
    top: `${end.top - origin.top + container.scrollTop}px`,
    width: `${end.width}px`,
    height: `${end.height}px`,
    borderRadius: style.borderRadius,
    background: style.backgroundColor,
    boxShadow: style.boxShadow,
  });
  container.appendChild(ghost);
  to.classList.add('selection-arriving');
  const dx = start.left - end.left;
  const dy = start.top - end.top;
  const animation = ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${start.width / end.width}, ${start.height / end.height})` },
    { transform: 'none' },
  ], { duration: DURATION.base, easing: EASING.spring });
  const done = () => { ghost.remove(); to.classList.remove('selection-arriving'); };
  animation.finished.then(done, done);
}

/** Keeps a list's selection gliding: call with the container and a selector for its selected item. */
export function useGlidingSelection(containerRef: { current: HTMLElement | null }, selectedSelector: string, key: unknown): void {
  const previous = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const current = container?.querySelector<HTMLElement>(selectedSelector) ?? null;
    if (container) glideSelection(container, previous.current, current);
    previous.current = current;
  }, [containerRef, selectedSelector, key]);
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void>; ready: Promise<void> } };

/**
 * Runs a layout change as a view transition: the layout (and so every terminal's size) changes once, while the
 * snapshots animate. `kind` selects the choreography in motion.css via html[data-layout-transition].
 */
export function layoutTransition(kind: string, update: () => void): void {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) { update(); return; }
  document.documentElement.dataset.layoutTransition = kind;
  const transition = doc.startViewTransition(() => flushSync(update));
  const clear = () => { if (document.documentElement.dataset.layoutTransition === kind) delete document.documentElement.dataset.layoutTransition; };
  transition.finished.then(clear, clear);
  transition.ready.catch(() => {});
}
