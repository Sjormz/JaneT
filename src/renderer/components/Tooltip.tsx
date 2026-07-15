import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

interface TooltipChildProps {
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-tooltip'?: string;
  'data-tooltip-label'?: string;
  'data-tooltip-shortcut'?: string;
  'data-tooltip-placement'?: TooltipPlacement;
}

export interface TooltipProps {
  label: string;
  shortcut?: string;
  placement?: TooltipPlacement;
  children: React.ReactElement;
}

/**
 * Adds tooltip metadata and event handlers directly to its only child. The
 * visible help is portaled to the document body so drag regions, clipped
 * panels, grids, and button groups do not gain a layout wrapper.
 */
export default function Tooltip({
  label,
  shortcut,
  placement = 'top',
  children,
}: TooltipProps) {
  const tooltipId = useId();
  const showTimer = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const child = React.Children.only(children);
  const childProps = child.props as TooltipChildProps & React.HTMLAttributes<HTMLElement>;
  const hasAccessibleLabel = Boolean(
    childProps['aria-label'] || childProps['aria-labelledby'],
  );
  const tooltipText = shortcut ? `${label} · ${shortcut}` : label;
  const tooltipProps: TooltipChildProps = {
    // A native title would duplicate the styled tooltip and cannot be themed.
    title: undefined,
    'data-tooltip': tooltipText,
    'data-tooltip-label': label,
    'data-tooltip-shortcut': shortcut,
    'data-tooltip-placement': placement,
  };

  if (!hasAccessibleLabel) {
    tooltipProps['aria-label'] = label;
  }

  const clearShowTimer = () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = null;
  };

  const show = (element: HTMLElement, delay: number) => {
    clearShowTimer();
    setAnchor(element.getBoundingClientRect());
    showTimer.current = window.setTimeout(() => {
      setVisible(true);
      showTimer.current = null;
    }, delay);
  };

  const hide = () => {
    clearShowTimer();
    setVisible(false);
    setPosition(null);
  };

  useEffect(() => {
    const dismiss = () => hide();
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      clearShowTimer();
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible || !anchor || !tooltipRef.current) return;
    const bounds = tooltipRef.current.getBoundingClientRect();
    setPosition(calculateTooltipPosition(
      anchor,
      placement,
      bounds.width,
      bounds.height,
      window.innerWidth,
      window.innerHeight,
    ));
  }, [anchor, label, placement, shortcut, visible]);

  const describedBy = visible
    ? [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ')
    : childProps['aria-describedby'];

  const cloned = React.cloneElement(
    child as React.ReactElement<any>,
    {
      ...tooltipProps,
      'aria-describedby': describedBy || undefined,
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
        childProps.onPointerEnter?.(event);
        hoveredRef.current = true;
        if (!event.defaultPrevented && !visible) show(event.currentTarget, 360);
      },
      onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
        childProps.onPointerLeave?.(event);
        hoveredRef.current = false;
        if (!focusedRef.current) hide();
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        childProps.onFocus?.(event);
        focusedRef.current = true;
        if (!event.defaultPrevented && !visible) show(event.currentTarget, 120);
      },
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        childProps.onBlur?.(event);
        focusedRef.current = false;
        if (!hoveredRef.current) hide();
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        childProps.onKeyDown?.(event);
        if (event.key === 'Escape') hide();
      },
    },
  );

  return (
    <>
      {cloned}
      {visible && anchor && createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="tooltip-popover"
          data-placement={placement}
          style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
        >
          <span>{label}</span>
          {shortcut && <kbd>{shortcut}</kbd>}
        </span>,
        document.body,
      )}
    </>
  );
}

export function calculateTooltipPosition(
  rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>,
  placement: TooltipPlacement,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): React.CSSProperties {
  const gap = 8;
  const margin = 8;
  let resolvedPlacement = placement;
  if (placement === 'top' && rect.top - gap - height < margin) resolvedPlacement = 'bottom';
  if (placement === 'bottom' && rect.bottom + gap + height > viewportHeight - margin) resolvedPlacement = 'top';
  if (placement === 'left' && rect.left - gap - width < margin) resolvedPlacement = 'right';
  if (placement === 'right' && rect.right + gap + width > viewportWidth - margin) resolvedPlacement = 'left';

  let left = rect.left + rect.width / 2 - width / 2;
  let top = rect.top + rect.height / 2 - height / 2;
  if (resolvedPlacement === 'top') top = rect.top - gap - height;
  if (resolvedPlacement === 'bottom') top = rect.bottom + gap;
  if (resolvedPlacement === 'left') left = rect.left - gap - width;
  if (resolvedPlacement === 'right') left = rect.right + gap;

  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}
