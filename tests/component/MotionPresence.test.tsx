import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MotionPresence from '../../src/renderer/components/MotionPresence';

function animationEnvironment(reduced = false) {
  const preference = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => preference);
  const animations: Array<{ finished: Promise<void>; finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  const animate = vi.fn(() => {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    const animation = { finished, finish, cancel: vi.fn(() => reject(new Error('cancelled'))) };
    animations.push(animation);
    return animation;
  });
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  return { preference, animations, animate, restore: () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  } };
}

afterEach(() => vi.unstubAllGlobals());

describe('MotionPresence', () => {
  it('fades menus without changing the geometry used to clamp them inside the window', () => {
    const environment = animationEnvironment();
    try {
      render(<MotionPresence><div role="menu">Menu</div></MotionPresence>);
      expect(environment.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], expect.anything());
    } finally { environment.restore(); }
  });

  it('retains the last visual but removes interaction and semantics until exit finishes', async () => {
    const environment = animationEnvironment();
    try {
      const { rerender, container } = render(<MotionPresence><div role="dialog">Original title</div></MotionPresence>);
      expect(environment.animate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ duration: 180 }));
      rerender(<MotionPresence>{false}</MotionPresence>);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(container.querySelector('[inert][aria-hidden="true"]')).toHaveTextContent('Original title');
      expect(environment.animate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ duration: 120 }));
      await act(async () => environment.animations.at(-1)!.finish());
      expect(container).toBeEmptyDOMElement();
    } finally { environment.restore(); }
  });

  it('cancels a stale exit when reopened and does not remove the new surface', async () => {
    const environment = animationEnvironment();
    try {
      const { rerender } = render(<MotionPresence><div role="dialog">First</div></MotionPresence>);
      rerender(<MotionPresence>{null}</MotionPresence>);
      const exit = environment.animations.at(-1)!;
      rerender(<MotionPresence><div role="dialog">Reopened</div></MotionPresence>);
      await act(async () => exit.finish());
      expect(exit.cancel).toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toHaveTextContent('Reopened');
      expect(screen.getByRole('dialog').closest('[inert]')).toBeNull();
    } finally { environment.restore(); }
  });

  it('skips animation for reduced motion and removes an exiting surface if the preference changes', async () => {
    const environment = animationEnvironment(true);
    try {
      const { rerender, container } = render(<MotionPresence><div>Reduced</div></MotionPresence>);
      rerender(<MotionPresence>{null}</MotionPresence>);
      expect(environment.animate).not.toHaveBeenCalled();
      expect(container).toBeEmptyDOMElement();
      environment.preference.matches = false;
      rerender(<MotionPresence><div>Animated</div></MotionPresence>);
      rerender(<MotionPresence>{null}</MotionPresence>);
      environment.preference.matches = true;
      await act(async () => environment.preference.addEventListener.mock.calls.at(-1)![1]());
      expect(container).toBeEmptyDOMElement();
    } finally { environment.restore(); }
  });
});
