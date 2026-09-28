import { describe, expect, it } from 'vitest';
import { DURATION, EASING, exitDuration } from '../../src/renderer/components/motion';
import { readRendererStylesheets } from './stylesheets';

const css = readRendererStylesheets();
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

describe('motion tokens', () => {
  it('keeps the WAAPI helper and the CSS custom properties in sync', () => {
    for (const [name, ms] of Object.entries(DURATION)) expect(token(`dur-${name}`)).toBe(`${ms}ms`);
    expect(token('ease-out-expo')).toBe(EASING.outExpo);
    expect(token('ease-in')).toBe(EASING.in);
    expect(token('ease-spring')).toBe(EASING.spring);
  });

  it('shortens exits relative to entrances', () => {
    expect(exitDuration(DURATION.base)).toBeLessThan(DURATION.base);
    expect(exitDuration(DURATION.base)).toBe(156);
  });
});

describe('semantic tokens', () => {
  it('defines every semantic name the design system uses', () => {
    for (const name of ['material-window', 'material-chrome', 'material-floating', 'material-content', 'accent-solid', 'accent-soft',
      'accent-ring', 'separator', 'separator-strong', 'fill-hover', 'fill-selected', 'status-ok', 'status-warn', 'status-err',
      'shadow-pane', 'shadow-floating', 'radius-control', 'radius-row', 'radius-pane', 'radius-floating']) {
      expect(token(name), name).toBeTruthy();
    }
  });
});
