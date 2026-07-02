import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

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
  onCwdChange?: (termId: string, cwd: string) => void;
  onFocus?: (termId: string) => void;
  initialCwd?: string;
  hasSession?: boolean;
  sshShellReady?: boolean;
  onSshRetry?: (termId: string) => void;
}

const MIN_SSH_COLS = 120;
const MIN_SSH_ROWS = 40;

function sshDimensions(dims: { cols: number; rows: number } | undefined | null) {
  return {
    cols: Math.max(dims?.cols || 80, MIN_SSH_COLS),
    rows: Math.max(dims?.rows || 24, MIN_SSH_ROWS),
  };
}

function repaintTerminal(term: Terminal, fitAddon: FitAddon): void {
  try { fitAddon.fit(); } catch {}
  try { term.refresh(0, Math.max(term.rows - 1, 0)); } catch {}
}

interface CachedTerminalPane {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  cleanup: unknown[];
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  sshShellReady: boolean;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const terminalPaneCache = new Map<string, CachedTerminalPane>();

export function disposeCachedTerminal(termId: string): void {
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
  // A TerminalPane unmount can mean "hidden because another tab is active",
  // not "closed". Disposing the frontend xterm here drops the visible buffer
  // while the backend SSH/local session keeps running, so switching back shows
  // a blank pane until fresh output arrives. App.tsx explicitly disposes the
  // cache when the leaf is actually removed from the tab tree.
}

export default function TerminalPane({
  termId,
  tabType,
  sshSessionId,
  onReady,
  onRemoved,
  themeName,
  fontSize,
  onCwdChange,
  onFocus,
  initialCwd,
  hasSession,
  sshShellReady = true,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ resultIndex: 0, resultCount: 0 });
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
    if (
      cached &&
      cached.tabType === tabType &&
      cached.sshSessionId === sshSessionId &&
      cached.sshShellReady === sshShellReady
    ) {
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

      repaintTerminal(term, fitAddon);
      const repaintTimer = setTimeout(() => repaintTerminal(term, fitAddon), 0);
      mountCleanup.push(() => clearTimeout(repaintTimer));

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
                window.janet.sshResizeShell({ termId, ...sshDimensions(dims) });
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

    searchAddon.onDidChangeResults((results) => {
      setSearchResults(results);
    });

    term.open(container);
    fitAddon.fit();

    const disposable = term.onData((data) => {
      if (tabType === 'local') {
        window.janet.terminalWrite({ id: termId, data });
      } else if (tabType === 'ssh') {
        window.janet.sshWriteShell({ termId, data });
      }
    });
    cleanupRef.current.push(() => disposable.dispose());

    const cleanupListener = window.janet.onTerminalData(({ id, data }) => {
      if (id === termId) {
        term.write(data);
      }
    });
    cleanupRef.current.push(cleanupListener);

    if (tabType === 'ssh' && sshSessionId && sshShellReady) {
      const dims = sshDimensions(fitAddon.proposeDimensions());
      const openShell = window.janet.sshCreateShell({
        id: sshSessionId,
        termId,
        cols: dims.cols,
        rows: dims.rows,
      });
      openShell.then(() => {
        onReady(termId);
        term.focus();
      }).catch((err: any) => {
        onReady(termId);
        const message = err?.message || 'connection may have dropped';
        term.write('\r\n\x1b[31mSSH shell failed to open: ' + message + '\x1b[0m\r\n');
      });
    } else if (hasSession) {
      onReady(termId);
    } else if (tabType === 'local') {
      window.janet.terminalCreate({ id: termId, cwd: initialCwd }).then(() => {
        onReady(termId);
      }).catch(console.error);
    }


    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(container);
    cleanupRef.current.push(() => resizeObserver.disconnect());

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
              window.janet.sshResizeShell({ termId, ...sshDimensions(dims) });
            }
          }
        } catch {}
      }, 150);
    };

    setTimeout(notifyResize, 100);

    window.addEventListener('resize', notifyResize);
    cleanupRef.current.push(() => window.removeEventListener('resize', notifyResize));

    const clickListener = () => term.focus();
    container.addEventListener('click', clickListener);
    cleanupRef.current.push(() => container.removeEventListener('click', clickListener));

    const focusListener = () => onFocus?.(termId);
    container.addEventListener('focusin', focusListener);
    cleanupRef.current.push(() => container.removeEventListener('focusin', focusListener));

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    let lastReportedCwd: string | null = initialCwd || null;
    if (initialCwd) onCwdChange?.(termId, initialCwd);

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
      return true;
    });
    cleanupRef.current.push(() => oscDisposable.dispose());
    cleanupRef.current.push(() => {
      if (cwdDebounce) clearTimeout(cwdDebounce);
    });

    terminalPaneCache.set(termId, {
      term,
      fitAddon,
      searchAddon,
      cleanup: cleanupRef.current,
      tabType,
      sshSessionId,
      sshShellReady,
      disposeTimer: null,
    });

    term.attachCustomKeyEventHandler((e) => {
      const currentBindings = kbBindingsRef.current;
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
  }, [termId, tabType, sshSessionId, sshShellReady, initialCwd, onReady, onRemoved, onFocus, onCwdChange]);

  useEffect(() => {
    if (termRef.current && themeName) {
      const themeDef = getTheme(themeName as ThemeName);
      termRef.current.options.theme = themeDef.xterm;
    }
  }, [themeName]);

  useEffect(() => {
    if (termRef.current && fontSize) {
      termRef.current.options.fontSize = fontSize;
      setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      }, 10);
    }
  }, [fontSize]);

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
    </div>
  );
}
