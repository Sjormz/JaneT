import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BrandMark, { BRAND_MARK_COLORS } from '../../src/renderer/components/BrandMark';
import Tooltip, { calculateTooltipPosition } from '../../src/renderer/components/Tooltip';

describe('BrandMark', () => {
  it('renders the small-size-first Prompt-J geometry with stable brand colors', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    const rect = container.querySelector('rect');
    const paths = container.querySelectorAll('path');

    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(rect).toHaveAttribute('fill', BRAND_MARK_COLORS.ink);
    expect(paths[0]).toHaveAttribute('stroke', BRAND_MARK_COLORS.periwinkle);
    expect(paths[1]).toHaveAttribute('stroke', BRAND_MARK_COLORS.mint);
  });

  it('supports a custom size, class, and accessible title', () => {
    render(<BrandMark size={32} className="product-mark" title="JaneT" />);

    const mark = screen.getByRole('img', { name: 'JaneT' });
    expect(mark).toHaveClass('product-mark');
    expect(mark).toHaveAttribute('width', '32');
    expect(mark).toHaveAttribute('height', '32');
    expect(mark.querySelector('title')).toHaveTextContent('JaneT');
    expect(mark).not.toHaveAttribute('aria-hidden');
  });
});

describe('Tooltip', () => {
  it('preserves the child DOM element and replaces a native title with tooltip metadata', () => {
    const { container } = render(
      <Tooltip label="Refresh files">
        <button type="button" title="Refresh">Refresh</button>
      </Tooltip>,
    );

    const button = screen.getByRole('button', { name: 'Refresh files' });
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).toBe(button);
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveAttribute('data-tooltip', 'Refresh files');
    expect(button).toHaveAttribute('data-tooltip-label', 'Refresh files');
    expect(button).toHaveAttribute('data-tooltip-placement', 'top');
  });

  it('supports shortcuts and placement without replacing an existing accessible label', () => {
    const onClick = vi.fn();
    render(
      <Tooltip label="Open command palette" shortcut="⌘K" placement="bottom">
        <button type="button" aria-label="Commands" onClick={onClick} />
      </Tooltip>,
    );

    const button = screen.getByRole('button', { name: 'Commands' });
    expect(button).toHaveAttribute('data-tooltip', 'Open command palette · ⌘K');
    expect(button).toHaveAttribute('data-tooltip-shortcut', '⌘K');
    expect(button).toHaveAttribute('data-tooltip-placement', 'bottom');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects aria-labelledby instead of adding a competing aria-label', () => {
    render(
      <>
        <span id="new-terminal-label">New terminal</span>
        <Tooltip label="Create terminal" placement="right">
          <button type="button" aria-labelledby="new-terminal-label" />
        </Tooltip>
      </>,
    );

    const button = screen.getByRole('button', { name: 'New terminal' });
    expect(button).not.toHaveAttribute('aria-label');
    expect(button).toHaveAttribute('data-tooltip', 'Create terminal');
    expect(button).toHaveAttribute('data-tooltip-placement', 'right');
  });

  it('renders styled hover and focus help in a portal and dismisses it with Escape', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip label="Refresh files" shortcut="⌘R" placement="right">
          <button type="button">Refresh</button>
        </Tooltip>,
      );

      const button = screen.getByRole('button', { name: 'Refresh files' });
      fireEvent.focus(button);
      act(() => vi.advanceTimersByTime(119));
      expect(screen.queryByRole('tooltip')).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh files⌘R');
      expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
      expect(button).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);

      fireEvent.keyDown(button, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      expect(button).not.toHaveAttribute('aria-describedby');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('keeps focused help visible when the pointer leaves, then hides it on blur', () => {
    vi.useFakeTimers();
    try {
      render(<Tooltip label="Open Explorer"><button type="button">Explorer</button></Tooltip>);
      const button = screen.getByRole('button', { name: 'Open Explorer' });

      fireEvent.focus(button);
      fireEvent.pointerEnter(button);
      act(() => vi.advanceTimersByTime(360));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.pointerLeave(button);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.blur(button);
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('flips and clamps help inside the viewport', () => {
    const nearTop = { top: 2, right: 130, bottom: 22, left: 100, width: 30, height: 20 };
    expect(calculateTooltipPosition(nearTop, 'top', 120, 28, 300, 200)).toEqual({ left: 55, top: 30 });

    const nearRight = { top: 80, right: 298, bottom: 100, left: 278, width: 20, height: 20 };
    expect(calculateTooltipPosition(nearRight, 'right', 120, 28, 300, 200)).toEqual({ left: 150, top: 76 });

    const oversized = calculateTooltipPosition(nearRight, 'bottom', 320, 50, 300, 200);
    expect(oversized.left).toBe(8);
    expect(oversized.top).toBeGreaterThanOrEqual(8);
  });
});
