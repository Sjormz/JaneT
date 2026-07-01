import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

/**
 * Run a list of cleanup entries. Each entry is either a function (called
 * with no args) or an object with a `.dispose()` method (called). Errors
 * are swallowed because a failing cleanup shouldn't mask the real reason
 * the component is unmounting.
 *
 * Exported for testing. We can't easily test the TerminalPane unmount
 * path because it requires a real xterm.js instance, but the cleanup
 * contract itself is simple and worth pinning down.
 */
export function runCleanup(entries: unknown[]): void {
  for (const entry of entries) {
    try {
      if (typeof entry === 'function') entry();
      else if (entry && typeof (entry as { dispose?: () => void }).dispose === 'function') {
        (entry as { dispose: () => void }).dispose();
      }
    } catch (e) {
      console.warn('[JaneT] cleanup error:', e);
    }
  }
}
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import SearchOverlay from './SearchOverlay';
import SSHConnectionNotice from './SSHConnectionNotice';
import { getTheme, ThemeName } from '../themes';
import { useKeybindings } from '../KeybindingsContext';
import { matchesShortcut } from '../keybindings';
import { fileUrlToPath } from '../osc7';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
  termId: string;
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  sshSessionLabel?: string;
  onReady: (termId: string) => void;
  onRemoved: (termId: string) => void;
  themeName?: string;
  fontSize?: number;
  /** Called when this terminal reports a new working directory (via OSC 7). */
  onCwdChange?: (termId: string, cwd: string) => void;
  /** Called when this terminal gains focus (so App can route cwd lookups here). */
  onFocus?: (termId: string) => void;
  /**
   * The initial working directory of this terminal. Used as a fallback
   * so the sidebar has something to show before the first OSC 7 arrives.
   */
  initialCwd?: string;
  /** True when this termId already has a live PTY/session to reuse. */
  hasSession?: boolean;
}

const REMOUNT_DISPOSE_DELAY_MS = 250;

interface CachedTerminalPane {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  cleanup: unknown[];
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const terminalPaneCache = new Map<string, CachedTerminalPane>();

function disposeCachedTerminal(termId: string): void {
  const cached = terminalPaneCache.get(termId);
  if (!cached) return;
  if (cached.disposeTimer) clearTimeout(cached.disposeTimer);
  runCleanup(cached.cleanup);
  cached.cleanup = [];
  cached.term.dispose();
  terminalPaneCache.delete(termId);
}

function scheduleCachedTerminalDispose(termId: string): void {
  const cached = terminalPaneCache.get(termId);
  if (!cached || cached.disposeTimer) return;
  cached.disposeTimer = setTimeout(() => {
    disposeCachedTerminal(termId);
  }, REMOUNT_DISPOSE_DELAY_MS);
}

export default function TerminalPane({
  termId,
  tabType,
  sshSessionId,
  sshSessionLabel,
  onReady,
  onRemoved,
  themeName,
  fontSize,
  onCwdChange,
  onFocus,
  initialCwd,
  hasSession,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ resultIndex: 0, resultCount: 0 });
  const [showSshNotice, setShowSshNotice] = useState(tabType === 'ssh');
  const searchVisibleRef = useRef(false);
  searchVisibleRef.current = searchVisible;

  const { bindings: kbBindings } = useKeybindings();

  const kbBindingsRef = useRef(kbBindings);
  kbBindingsRef.current = kbBindings;

  const closeSearch = () => {
    setSearchVisible(false);
    setSearchQuery('');
    setSearchResults({ resultIndex: 0, resultCount: 0 });
    if (searchAddonRef.current) {
      searchAddonRef.current.findNext('', { decorations: {} as any } as any);
    }
    termRef.current?.focus();
  };

  const doSearch = (query: string, dir: 'next' | 'prev' = 'next') => {
    if (!query || !searchAddonRef.current) {
      setSearchResults({ resultIndex: 0, resultCount: 0 });
      return;
    }
    const options = {
      decorations: {
        searchHighlight: true,
        matchOverviewRuler: true,
      } as any,
    };
    searchAddonRef.current[dir === 'next' ? 'findNext' : 'findPrevious'](query, options);
  };


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cached = terminalPaneCache.get(termId);
    if (cached && cached.tabType === tabType && cached.sshSessionId === sshSessionId) {
      if (cached.disposeTimer) {
        clearTimeout(cached.disposeTimer);
        cached.disposeTimer = null;
      }

      const mountCleanup: unknown[] = [];
      const { term, fitAddon, searchAddon } = cached;

      if (term.element && term.element.parentElement !== container) {
        container.appendChild(term.element);
      } else if (!term.element) {
        term.open(container);
      }

      try { fitAddon.fit(); } catch {}

      const resultsDisposable = searchAddon.onDidChangeResults((results) => {
        setSearchResults(results);
      });
      mountCleanup.push(resultsDisposable);

      const resizeObserver = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch {}
      });
      resizeObserver.observe(container);
      mountCleanup.push(() => resizeObserver.disconnect());

      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const notifyResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          try {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              if (tabType === 'local') {
                window.janet.terminalResize({ id: termId, cols: dims.cols, rows: dims.rows });
              } else if (tabType === 'ssh') {
                window.janet.sshResizeShell({ termId, cols: dims.cols, rows: dims.rows });
              }
            }
          } catch {}
        }, 150);
      };

      const initialResizeTimer = setTimeout(notifyResize, 0);
      mountCleanup.push(() => clearTimeout(initialResizeTimer));
      mountCleanup.push(() => { if (resizeTimer) clearTimeout(resizeTimer); });

      window.addEventListener('resize', notifyResize);
      mountCleanup.push(() => window.removeEventListener('resize', notifyResize));

      const clickListener = () => term.focus();
      container.addEventListener('click', clickListener);
      mountCleanup.push(() => container.removeEventListener('click', clickListener));

      const focusListener = () => onFocus?.(termId);
      container.addEventListener('focusin', focusListener);
      mountCleanup.push(() => container.removeEventListener('focusin', focusListener));

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      onReady(termId);

      return () => {
        runCleanup(mountCleanup);
        onRemoved(termId);
        scheduleCachedTerminalDispose(termId);
        termRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }

    if (cached) disposeCachedTerminal(termId);

    const resolvedTheme = themeName ? getTheme(themeName as ThemeName).xterm : undefined;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: fontSize || 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      lineHeight: 1.2,
      theme: resolvedTheme || {
        background: '#0f0f1a',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#1d1f2b',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    // Track search results
    searchAddon.onDidChangeResults((results) => {
      setSearchResults(results);
    });

    term.open(container);
    fitAddon.fit();

    // Create terminal session only when this termId doesn't already have one.
    // Split operations can remount an existing pane; in that case the PTY must
    // stay alive and only the new sibling terminal should be created.
    if (hasSession) {
      onReady(termId);
    } else if (tabType === 'local') {
      window.janet.terminalCreate({ id: termId }).then(() => {
        onReady(termId);
      }).catch(console.error);
    } else if (tabType === 'ssh' && sshSessionId) {
      const dims = fitAddon.proposeDimensions();
      window.janet.sshCreateShell({
        id: sshSessionId,
        termId,
        cols: dims?.cols || 80,
        rows: dims?.rows || 24,
      }).then(() => {
        onReady(termId);
        term.focus();
      }).catch(console.error);
    }

    // Terminal input -> PTY
    const disposable = term.onData((data) => {
      if (tabType === 'local') {
        window.janet.terminalWrite({ id: termId, data });
      } else if (tabType === 'ssh') {
        window.janet.sshWriteShell({ termId, data });
      }
    });
    cleanupRef.current.push(() => disposable.dispose());

    // PTY output -> Terminal  (handled below with OSC 7 stripping)

    // Handle resize via ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(container);
    cleanupRef.current.push(() => resizeObserver.disconnect());

    // Debounced resize notification to main process
    let resizeTimer: any;
    const notifyResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            if (tabType === 'local') {
              window.janet.terminalResize({ id: termId, cols: dims.cols, rows: dims.rows });
            } else if (tabType === 'ssh') {
              window.janet.sshResizeShell({ termId, cols: dims.cols, rows: dims.rows });
            }
          }
        } catch {}
      }, 150);
    };

    setTimeout(notifyResize, 100);

    // Listen for window resize
    window.addEventListener('resize', notifyResize);
    cleanupRef.current.push(() => window.removeEventListener('resize', notifyResize));

    // Focus terminal on click
    const clickListener = () => term.focus();
    container.addEventListener('click', clickListener);
    cleanupRef.current.push(() => container.removeEventListener('click', clickListener));

    // Track focus so App can route sidebar cwd to the currently-focused
    // terminal. xterm.js doesn't expose an onFocus event on the Terminal
    // class — we listen to DOM focus events on the container instead.
    // xterm renders a hidden <textarea> inside the container; the
    // focusin event fires on the container when the textarea (or any
    // child) gains focus.
    const focusListener = () => onFocus?.(termId);
    container.addEventListener('focusin', focusListener);
    cleanupRef.current.push(() => container.removeEventListener('focusin', focusListener));

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // OSC 7 cwd tracking. xterm.js has a built-in OSC parser
    // (term.parser) that detects sequences for us, reassembles them
    // across PTY chunk boundaries, and strips them from the visible
    // output. We just register a handler for OSC 7 and react to the
    // payload.
    //
    // Reference:
    //   https://xtermjs.org/docs/api/terminal/interfaces/iparser/#registeroschandler
    //
    // The "initialCwd" prop is what node-pty was launched with
    // (typically the user's home dir). We report it eagerly so the
    // sidebar has something to show before the first prompt emits an
    // OSC 7 sequence.
    let lastReportedCwd: string | null = initialCwd || null;
    if (initialCwd) onCwdChange?.(termId, initialCwd);

    // Debounce so a burst of OSC 7 sequences (e.g. a script that cd's
    // many times, or a tab completion that paints a path) doesn't
    // thrash the file tree.
    let cwdDebounce: ReturnType<typeof setTimeout> | null = null;
    const reportCwd = (newCwd: string) => {
      if (newCwd === lastReportedCwd) return;
      lastReportedCwd = newCwd;
      if (cwdDebounce) clearTimeout(cwdDebounce);
      cwdDebounce = setTimeout(() => {
        onCwdChange?.(termId, newCwd);
      }, 80);
    };

    const oscDisposable = term.parser.registerOscHandler(7, (data) => {
      const path = fileUrlToPath(data);
      if (path) reportCwd(path);
      return true; // consumed — don't let xterm render the payload
    });
    cleanupRef.current.push(() => oscDisposable.dispose());
    cleanupRef.current.push(() => {
      if (cwdDebounce) clearTimeout(cwdDebounce);
    });

    // PTY output -> xterm (no longer needs to strip OSC 7 — xterm
    // consumes it before it ever reaches the visible buffer).
    const cleanupListener = window.janet.onTerminalData(({ id, data }) => {
      if (id === termId) {
        if (tabType === 'ssh') {
          setShowSshNotice(false);
        }
        term.write(data);
      }
    });
    cleanupRef.current.push(cleanupListener);

    terminalPaneCache.set(termId, {
      term,
      fitAddon,
      searchAddon,
      cleanup: cleanupRef.current,
      tabType,
      sshSessionId,
      disposeTimer: null,
    });

    // Intercept keyboard shortcuts before xterm processes them

    term.attachCustomKeyEventHandler((e) => {
      const currentBindings = kbBindingsRef.current;
      // Check search-toggle shortcut (default Ctrl+F)
      if (matchesShortcut(e, currentBindings['search-toggle'])) {
        e.preventDefault();
        setSearchVisible((v) => !v);
        return false;
      }
      if (e.key === 'Escape' && searchVisibleRef.current) {
        e.preventDefault();
        closeSearch();
        return false;
      }
      return true;
    });

    return () => {
      onRemoved(termId);
      scheduleCachedTerminalDispose(termId);
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [termId, tabType, sshSessionId, initialCwd, onReady, onRemoved, onFocus, onCwdChange]);

  // Update xterm theme when themeName changes
  useEffect(() => {
    if (termRef.current && themeName) {
      const themeDef = getTheme(themeName as ThemeName);
      termRef.current.options.theme = themeDef.xterm;
    }
  }, [themeName]);

  // Update xterm font size when fontSize changes
  useEffect(() => {
    if (termRef.current && fontSize) {
      termRef.current.options.fontSize = fontSize;
      // Re-fit after font size change
      setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      }, 10);
    }
  }, [fontSize]);

  // Re-fit when the parent container becomes visible
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="terminal-container" ref={containerRef}>
      <SearchOverlay
        query={searchQuery}
        results={searchResults}
        visible={searchVisible}
        onQueryChange={(q) => {
          setSearchQuery(q);
          if (q) {
            doSearch(q);
          } else {
            setSearchResults({ resultIndex: 0, resultCount: 0 });
            if (searchAddonRef.current) {
              searchAddonRef.current.findNext('', { decorations: {} as any } as any);
            }
          }
        }}
        onNext={() => doSearch(searchQuery, 'next')}
        onPrev={() => doSearch(searchQuery, 'prev')}
        onClose={closeSearch}
      />
      <SSHConnectionNotice visible={showSshNotice} label={sshSessionLabel} />
    </div>
  );
}
