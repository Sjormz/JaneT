import React, { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DURATION, EASING, exitDuration } from './motion';

/** Keep only the exiting visual; the caller closes its focus/interaction state immediately. */
export default function MotionPresence({ children }: { children: ReactNode }) {
  const open = Boolean(children);
  const [present, setPresent] = useState(open);
  const previous = useRef<ReactNode>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => { if (open) previous.current = children; });
  useLayoutEffect(() => {
    const root = ref.current?.firstElementChild as HTMLElement | null;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!root?.animate || preference?.matches) {
      if (!open) previous.current = null;
      setPresent(open);
      return;
    }
    if (open) setPresent(true);
    const surface = root.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], .project-creation-content') ?? root;
    // Entrances use the base duration on the expo curve; exits are quicker and ease in (motion tokens).
    const timing = {
      duration: open ? DURATION.base : exitDuration(DURATION.base),
      easing: open ? EASING.outExpo : EASING.in,
      fill: 'both' as const,
    };
    // Floating layers grow from their transform-origin (the palette from the titlebar field).
    const offset = 'translateY(6px) scale(0.97)';
    // Menus measure their bounds while opening; keep their geometry stable.
    const frames = surface.matches('[role="menu"]') ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: offset }, { opacity: 1, transform: 'none' }];
    const animations = [surface.animate(open ? frames : [...frames].reverse(), timing)];
    if (surface !== root) animations.push(root.animate({ opacity: open ? [0, 1] : [1, 0] }, timing));
    let active = true;
    const finish = () => {
      if (!active) return;
      if (!open) { previous.current = null; setPresent(false); }
      animations.forEach(animation => animation.cancel());
    };
    void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    const reduce = () => { if (preference?.matches) finish(); };
    preference?.addEventListener('change', reduce);
    return () => {
      active = false;
      preference?.removeEventListener('change', reduce);
      animations.forEach(animation => animation.cancel());
    };
  }, [open]);

  if (!open && !present) return null;
  return <div ref={ref} className="motion-presence" data-motion-state={open ? 'open' : 'closing'} inert={!open} aria-hidden={!open || undefined}>
    {open ? children : previous.current}
  </div>;
}
