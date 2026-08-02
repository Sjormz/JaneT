import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/global.css'), 'utf8');

describe('native form control styles', () => {
  it('themes every native select and its interactive states', () => {
    expect(css).toMatch(/select\s*\{[^}]*appearance:\s*none[^}]*background[^}]*color:[^}]*var\(--text-primary\)[^}]*border:[^}]*var\(--border-subtle\)/s);
    const formInputRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gs)]
      .filter((rule) => rule[1].split(',').some((selector) => /\.form-input(?![\w-])/.test(selector)));
    expect(formInputRules.length).toBeGreaterThan(0);
    expect(formInputRules.some((rule) => /\bbackground\s*:/.test(rule[2]))).toBe(false);
    expect(css).toMatch(/select:hover:not\(:disabled\)/);
    expect(css).toMatch(/select:focus-visible/);
    expect(css).toMatch(/select:disabled/);
  });

  it('themes native checkboxes while preserving their semantics', () => {
    expect(css).toMatch(/input\[type=["']checkbox["']\]\s*\{[^}]*accent-color:\s*var\(--text-accent\)[^}]*cursor:\s*pointer/s);
    expect(css).toMatch(/input\[type=["']checkbox["']\]:focus-visible/);
    expect(css).toMatch(/input\[type=["']checkbox["']\]:disabled/);
  });
});
