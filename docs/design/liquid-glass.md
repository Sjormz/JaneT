# Liquid Glass design system

The reference for JaneT's renderer styling: how the window materials, tokens, motion and contrast rules fit together, and
the constraints that keep terminals fast and legible. User-facing behaviour (the Transparency setting, reduced motion) is
documented in the guide, in [`docs/site/guide/settings.md`](../site/guide/settings.md).

The frame is glass; the work is paper. One continuous translucent frame (titlebar, rails, status bar) holds opaque content
cards (terminals, editor, diff, file lists), separated by a single 6px gutter. Floating layers (palette, menus, popovers,
dialogs, tooltips) are thicker glass that blurs the workspace beneath them.

## Stylesheets

`src/renderer/styles/index.css` imports everything in cascade order. The layers, lowest to highest, are:

- `tokens`
- `base`
- `components` (one file per surface in `styles/components/`)
- `utilities`
- `motion`

A later layer wins regardless of selector specificity.

- `tokens.css`: the palette defaults, the semantic layer, the scales, and every material variant.
- `materials.css` (utilities layer): assigns a material tier to each surface in one place. Components own shape, spacing
  and borders, never their tier.
- `motion.css` (motion layer): every keyframe, animation and view-transition rule. No other file declares animations.
- `vendor-overrides.css`: deliberately **unlayered**, so it still beats xterm's and Monaco's own CSS.

Declare only the unprefixed `backdrop-filter`. Vite's minifier (Lightning CSS) keeps just one of `backdrop-filter` and
`-webkit-backdrop-filter`, whichever comes last, and Chromium ignores the prefixed form. A pair therefore silently removes
the blur from packaged builds, while `npm run dev` still shows it. `tests/unit/materialStyles.test.ts` guards this.

## Materials

There are four tiers only.

| Token | Surfaces | Composition |
|---|---|---|
| `--material-window` | `html` | `--bg-primary` at 40% over the OS material (macOS `vibrancy: 'under-window'`, Windows 11 22H2+ Mica), otherwise 100% |
| `--material-chrome` | Titlebar, both rails, status bar | `--bg-secondary` at 78% (dark) / 72% (light). No `backdrop-filter`. |
| `--material-floating` | Palette, pickers, menus, popovers, dialogs, search, tooltips | `--bg-secondary` at 82% / 84% with `blur(40px) saturate(180%)` (170% light), a specular edge and a three-layer shadow |
| `--material-content` | Terminal, editor, diff, file lists | The theme background: opaque, never blurred, scaled or animated |

Chrome is only a tint. Nothing scrolls under it, the OS material already blurs the desktop, and in Chromium an element with
a backdrop filter becomes the backdrop root for its descendants. A blurred titlebar would stop the settings popover inside
it from blurring the workspace.

`<html>` carries the state that selects the token variants:

- `data-scheme`: `dark` or `light`, derived from the theme's canvas colour by `themeScheme()`.
- `data-transparency`: `full`, `reduced` or `off`, the effective value of the Transparency setting.
  - `system` resolves to `reduced` when the OS asks for reduced transparency.
  - `reduced` gives 94% chrome and 96% floating, with lighter blur, over an opaque window.
  - `off` makes everything solid and unblurred.
- `data-window-material`: `vibrancy`, `mica` or `none`, whatever the main process actually applied.

`prefers-contrast: more` always forces solid, unblurred surfaces.

Window integration lives in `src/main/windowMaterial.ts`:

- The window is created with `show: false` and shown on `ready-to-show`, so a transparent window never flashes.
- The initial material reaches the preload through `additionalArguments`, and the renderer sets the attributes before
  React mounts.
- `nativeTheme.themeSource` follows the theme's scheme, so vibrancy is never light behind a dark theme.
- `applyWindowMaterial` changes only what differs. Reconfiguring vibrancy relayouts the window, which resizes every
  terminal.
- `THEME_WINDOW` must stay in step with the themes; a unit test checks it.

xterm keeps an opaque background with `allowTransparency: false`. Glass never sits under terminal glyphs, which keeps text
crisp and the WebGL renderer fast. Blurred layers exist only while a floating surface is open, and none of them overlaps a
streaming terminal.

## Tokens

### Semantic colour

Components read semantic names:

| Group | Tokens |
|---|---|
| Accent | `--accent-solid`, `--accent-soft`, `--accent-ring`, `--accent-text`, `--on-accent` |
| Separators | `--separator`, `--separator-strong` |
| Fills | `--fill-hover`, `--fill-selected`, `--fill-track` |
| Status | `--status-ok`, `--status-warn`, `--status-err` |
| Shadows and edges | `--shadow-pane`, `--shadow-floating`, `--specular`, `--scrim` |

`themes.ts` holds each theme's raw palette and its xterm theme. `applyCssTheme` writes the palette to `<html>` and removes
any optional key the previous theme set that the new one omits.

Per-theme decisions:

- **Selections and tracks.** `--fill-track` is a neutral recessed fill for segmented controls. It is deliberately not the
  selection colour, which is saturated in some themes (Tokyo Night's blue). Metadata on a selected row inherits the row's
  text colour rather than using tertiary text.
- **Accent text.** `--accent-text` is the accent used for text. Dracula overrides it with `#caa9fa`, because its purple is
  4.35:1 on raised fills.
- **Solarized Light** is warm frosted paper rather than an inverted dark theme: brown-tinted shadows and hairlines, and a
  solid white selection pill with a hairline instead of a translucent fill.

Monaco (`monacoRuntime.ts`) takes its base theme from `themeScheme()`. Its syntax, gutter, line-highlight, scrollbar and
diff colours come from the palette, so the editor matches the terminal and the chrome.

### Type, spacing, shape

- **Fonts.** Inter Variable for UI. JetBrains Mono only for terminal, code, paths and hashes.
- **Type scale.** `--text-xs/sm/base/md/lg/xl` = 11/12/13/15/20/28px. Weights `--weight-body/label/title` = 400/500/600.
  Section headers are sentence case, never all caps.
- **Numerals.** Counts, timers, sizes and versions use `tabular-nums`.
- **Spacing.** A 4px grid, `--space-1..8` = 4, 8, 12, 16, 20, 24, 32px. One `--space-gutter` of 6px sits between panes,
  and between the frame and the panes.
- **Radii.** These are concentric: `--radius-control` 6, `--radius-row` 10, `--radius-pane` 14, `--radius-floating` 20.
  An inner radius equals the outer radius minus the padding. The window corner is left to the OS.
- **Heights.** Titlebar 44px, status bar 26px. Hit targets are at least 28px.
- **Icons.** Lucide at a 1.5px stroke, 14px in rows and 16px in the titlebar and rail. They are tertiary until hovered or
  selected.
- **Shortcuts.** Keycaps come from `shortcutKeycaps()`, so every surface shows the same platform glyphs (⌘⌃⌥⇧↩ on macOS).

## Motion

Motion explains a change. It never touches terminal text: panes may fade or move by whole pixels, but xterm output is
never scaled, blurred or animated.

- **Tokens.** `--dur-instant/quick/base/slow` = 90/160/240/360ms. Easings are `--ease-out-expo`, `--ease-in` and
  `--ease-spring` (a `linear()` curve with 2% overshoot). `components/motion.ts` mirrors them for WAAPI (`DURATION`,
  `EASING`), and exits run at 65% of the entrance duration (`exitDuration`).
- **Layout changes** use `layoutTransition(kind, update)`: a view transition whose update runs in `flushSync`.
  - Collapsing or expanding a rail changes the layout once, so each terminal re-fits and resizes its PTY exactly once.
  - During the collapse, terminal snapshots are pinned via `view-transition-class: terminal-pane`, while the rail's
    snapshot clips and fades.
  - Pane maximize and theme switches also use view transitions.
- **Selection.** `useGlidingSelection` covers tabs, tools, segmented controls and palette rows. It glides a ghost of the
  old selection to the new one, with a spring.
- **Transient layers.** `MotionPresence` keeps an exiting layer's last frame, while its focus and semantics leave
  immediately (`inert`, `aria-hidden`).
- **Launch.** `html.is-launching` is set for one 700ms pass. The mark resolves, the chrome arrives from its edges in a 40ms
  stagger, and the panes fade up. It never delays input or terminal startup.
- **Small touches.** Lists stagger by 14ms per row (`--i`, capped at 8). Controls press to 0.97 scale. The activity dot
  breathes.
- **Reduced motion.** Under `prefers-reduced-motion: reduce` everything is instant, except the update spinner, which
  carries state.

## Contrast

Text on glass must reach 4.5:1, or 3:1 for large text, against the worst backdrop it can have:

- **Chrome.** Its ancestors (the window tint) over the theme-matched OS material. A page cannot read the real desktop, so
  the test models the material as `rgb(36 36 38)` for dark and `rgb(236 236 236)` for light. Over a raw white desktop
  with no OS tint, no chrome alpha below 1.0 passes for dark themes. That is why `themeSource` must follow the scheme.
- **Floating.** The layer's own backgrounds over the opaque content, and over a blurred dense-text region modelled as 40%
  ink on that content.

`tests/e2e/theme-contrast.spec.ts` measures every visible text element in the titlebar, both rails, the status bar, the
settings popover and the palette. That is 146 elements per theme, in all 5 themes, with Transparency at System and at
Reduced. Disabled controls are skipped.

- Thinning floating glass to 10% makes it fail in every dark theme. That confirms the check is live.
- The opacity floors in `tests/unit/materialStyles.test.ts` are chrome ≥ 76% dark / 70% light and floating ≥ 80% dark /
  62% light.

## Platforms

| Platform | Window material | Notes |
|---|---|---|
| macOS | Vibrancy (`under-window`, `followWindow`) | Traffic lights stay at {14, 14}; the 44px titlebar centres them. |
| Windows 11 22H2+ | Mica | Acrylic is avoided: noisier and more expensive during window drags. |
| Windows 10 / earlier 11 | None (opaque) | In-app glass still blurs. |
| Linux | None (opaque) | CI runs under Xvfb (software GL), so blur there checks correctness, not performance. |

Page screenshots, including Playwright captures, cannot see vibrancy or Mica. Review full transparency in the running app;
captures with Transparency at Reduced are the closest faithful picture.

## Review tooling

- `tests/e2e/design-captures.spec.ts` captures every surface in the real app. It uses an isolated profile, a synthetic
  `HOME` (prompt `demo@janet`) and a fixture repo under `/private/tmp/JaneT-Design`. It is opt-in and skipped in CI.
  Output goes to `test-results/design-captures/` unless `JANET_DESIGN_OUT` redirects it.

  ```bash
  JANET_DESIGN_CAPTURE=1 JANET_DESIGN_TRANSPARENCY=reduced npx playwright test --config playwright.config.ts tests/e2e/design-captures.spec.ts
  ```

  Filters: `JANET_DESIGN_THEMES`, `JANET_DESIGN_VIEWPORTS`. Set `JANET_DESIGN_STYLES=1` to also dump each surface's
  computed styles.
- `scripts/design-style-diff.mjs <baseline> <candidate>` compares two style dumps. Use it to prove a CSS refactor changes
  nothing on screen.
- `tests/e2e/performance-baseline.spec.ts` records startup, loaded-terminal input latency and GPU memory. The budget for
  styling work is within 5% of `main`, measured alternately on the same host, because the numbers drift between sessions.
