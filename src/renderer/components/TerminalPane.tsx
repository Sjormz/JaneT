import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';

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
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import SearchOverlay from './SearchOverlay';
import SSHConnectionNotice from './SSHConnectionNotice';
import { getTheme, ThemeName } from '../themes';
import { useKeybindings } from '../KeybindingsContext';
import { matchesShortcut } from '../keybindings';
import { fileUrlToPath } from '../osc7';
import { createKittyGraphicsLayer } from '../kittyGraphics';
import { refreshCoordinator } from '../refreshCoordinator';
import { TERMINAL_SEARCH_REQUEST_EVENT, TerminalSearchRequestDetail } from '../terminalSearch';
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
  sshConnectionLost?: boolean;
  onSshRetry?: (termId: string, dimensions: { cols: number; rows: number }) => void | Promise<void>;
}

type SshNoticeState = React.ComponentProps<typeof SSHConnectionNotice>['state'];

const MIN_SSH_COLS = 120;
const MIN_SSH_ROWS = 40;

const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBorder: '#7aa2f7',
    matchOverviewRuler: '#7aa2f7',
    activeMatchBorder: '#e0af68',
    activeMatchColorOverviewRuler: '#e0af68',
  },
};

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

function usableDimensions(dims: { cols: number; rows: number } | undefined | null) {
  if (!dims || dims.cols <= 0 || dims.rows <= 0) return null;
  return dims;
}

interface CachedTerminalPane {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  hasActiveSearch: boolean;
  cleanup: unknown[];
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  sshShellReady: boolean;
  sshNoticeState: SshNoticeState;
  sshNoticeListener: ((state: SshNoticeState) => void) | null;
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
  sshSessionLabel,
  onReady,
  onRemoved,
  themeName,
  fontSize,
  onCwdChange,
  onFocus,
  initialCwd,
  hasSession,
  sshShellReady = true,
  sshConnectionLost = false,
  onSshRetry,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const sshNoticeAttemptRef = useRef(0);

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ resultIndex: 0, resultCount: 0 });
  const [sshNoticeState, setSshNoticeState] = useState<SshNoticeState>(
    () => terminalPaneCache.get(termId)?.sshNoticeState ?? { kind: 'hidden' },
  );
  const componentMountedRef = useRef(false);
  const searchVisibleRef = useRef(false);
  searchVisibleRef.current = searchVisible;

  useEffect(() => {
    componentMountedRef.current = true;
    return () => { componentMountedRef.current = false; };
  }, []);

  const publishSshNoticeState = useCallback((next: SshNoticeState) => {
    const cached = terminalPaneCache.get(termId);
    if (cached) {
      cached.sshNoticeState = next;
      if (cached.sshNoticeListener) cached.sshNoticeListener(next);
      else if (componentMountedRef.current) setSshNoticeState(next);
    } else if (componentMountedRef.current) {
      setSshNoticeState(next);
    }
  }, [termId]);

  const { bindings: kbBindings } = useKeybindings();

  const kbBindingsRef = useRef(kbBindings);
  kbBindingsRef.current = kbBindings;

  useEffect(() => {
    if (tabType !== 'ssh') {
      publishSshNoticeState({ kind: 'hidden' });
    } else if (sshConnectionLost) {
      publishSshNoticeState({
        kind: 'error',
        message: 'The SSH connection closed. Reconnect to continue.',
      });
    } else if (!sshShellReady) {
      publishSshNoticeState({ kind: 'reconnecting' });
    }
  }, [publishSshNoticeState, sshConnectionLost, tabType, sshSessionId, sshShellReady]);

  const clearSearchSelection = () => {
    searchAddonRef.current?.clearDecorations();
    termRef.current?.clearSelection();
    const cached = terminalPaneCache.get(termId);
    if (cached) cached.hasActiveSearch = false;
  };

  const closeSearch = () => {
    setSearchVisible(false);
    setSearchQuery('');
    setSearchResults({ resultIndex: 0, resultCount: 0 });
    clearSearchSelection();
    termRef.current?.focus();
  };

  useEffect(() => {
    const openRequestedSearch = (event: Event) => {
      const request = event as CustomEvent<TerminalSearchRequestDetail>;
      if (request.detail?.termId !== termId) return;
      setSearchVisible(true);
    };
    window.addEventListener(TERMINAL_SEARCH_REQUEST_EVENT, openRequestedSearch);
    return () => window.removeEventListener(TERMINAL_SEARCH_REQUEST_EVENT, openRequestedSearch);
  }, [termId]);

  const syncTerminalSize = (term: Terminal, fitAddon: FitAddon) => {
    try {
      fitAddon.fit();
      const dims = usableDimensions(fitAddon.proposeDimensions());
      if (!dims) return;
      const last = lastResizeRef.current;
      if (last?.cols === dims.cols && last?.rows === dims.rows) return;
      lastResizeRef.current = dims;
      if (tabType === 'local') {
        window.janet.terminalResize({ id: termId, cols: dims.cols, rows: dims.rows });
      } else if (tabType === 'ssh') {
        window.janet.sshResizeShell({ termId, ...sshDimensions(dims) });
      }
      term.refresh(0, Math.max(term.rows - 1, 0));
    } catch {}
  };


  const doSearch = (query: string, dir: 'next' | 'prev' = 'next') => {
    if (!query || !searchAddonRef.current) {
      setSearchResults({ resultIndex: 0, resultCount: 0 });
      clearSearchSelection();
      return;
    }
    const cached = terminalPaneCache.get(termId);
    if (cached) cached.hasActiveSearch = true;
    searchAddonRef.current[dir === 'next' ? 'findNext' : 'findPrevious'](query, SEARCH_OPTIONS);
  };

  const attachTerminal = (container: HTMLDivElement, term: Terminal, fitAddon: FitAddon, searchAddon: SearchAddon, initialDelay: number) => {
    const mountCleanup: unknown[] = [];
    const cached = terminalPaneCache.get(termId);
    if (!searchQuery && cached?.hasActiveSearch) {
      searchAddon.clearDecorations();
      term.clearSelection();
      cached.hasActiveSearch = false;
    }
    mountCleanup.push(searchAddon.onDidChangeResults((results) => setSearchResults(results)));
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const notifyResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => syncTerminalSize(term, fitAddon), 50);
    };
    const resizeObserver = new ResizeObserver(notifyResize);
    resizeObserver.observe(container);
    mountCleanup.push(() => resizeObserver.disconnect());
    const initialResizeTimer = setTimeout(notifyResize, initialDelay);
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
    term.attachCustomKeyEventHandler((e) => {
      const currentBindings = kbBindingsRef.current;
      if (matchesShortcut(e, currentBindings['search-toggle'])) {
        e.preventDefault();
        setSearchVisible((visible) => !visible);
        return false;
      }
      if (e.key === 'Escape' && searchVisibleRef.current) {
        e.preventDefault();
        closeSearch();
        return false;
      }
      return true;
    });
    // xterm keeps one handler for its full lifetime. Replace the component
    // closure while cached/detached so it cannot update an unmounted pane.
    mountCleanup.push(() => term.attachCustomKeyEventHandler(() => true));
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    return mountCleanup;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let effectActive = true;

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

      const { term, fitAddon, searchAddon } = cached;
      cached.sshNoticeListener = setSshNoticeState;

      if (term.element && term.element.parentElement !== container) {
        container.appendChild(term.element);
      } else if (!term.element) {
        term.open(container);
      }

      repaintTerminal(term, fitAddon);
      const repaintTimer = setTimeout(() => repaintTerminal(term, fitAddon), 0);
      const mountCleanup = attachTerminal(container, term, fitAddon, searchAddon, 0);
      mountCleanup.push(() => clearTimeout(repaintTimer));
      if (tabType !== 'ssh') {
        publishSshNoticeState({ kind: 'hidden' });
      }
      onReady(termId);

      return () => {
        effectActive = false;
        runCleanup(mountCleanup);
        onRemoved(termId);
        scheduleCachedTerminalDispose(termId);
        const currentCache = terminalPaneCache.get(termId);
        if (currentCache?.sshNoticeListener === setSshNoticeState) {
          currentCache.sshNoticeListener = null;
        }
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
      // xterm 6 still marks parser.registerOscHandler as proposed; this is
      // needed for local shell cwd integration and must be rechecked on upgrade.
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    const webLinksAddon = new WebLinksAddon((event, url) => {
      event.preventDefault();
      window.janet.openExternal(url).catch(() => {});
    });
    const searchAddon = new SearchAddon();

    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(container);
    fitAddon.fit();

    const lifetimeCleanup: unknown[] = [];
    const kittyGraphics = tabType === 'local' ? createKittyGraphicsLayer(term) : null;
    if (kittyGraphics) lifetimeCleanup.push(kittyGraphics);

    const disposable = term.onData((data) => {
      if (tabType === 'local') {
        window.janet.terminalWrite({ id: termId, data });
      } else if (tabType === 'ssh') {
        window.janet.sshWriteShell({ sessionId: sshSessionId, termId, data });
      }
    });
    lifetimeCleanup.push(disposable);

    const binaryDisposable = term.onBinary((data) => {
      if (tabType === 'local') {
        window.janet.terminalWriteBinary({ id: termId, data });
      } else {
        window.janet.sshWriteShellBinary({ sessionId: sshSessionId, termId, data });
      }
    });
    lifetimeCleanup.push(binaryDisposable);

    const cleanupListener = window.janet.onTerminalData(({ id, data }) => {
      if (id === termId) {
        sshNoticeAttemptRef.current += 1;
        publishSshNoticeState({ kind: 'hidden' });
        kittyGraphics?.push(data);
        term.write(data);
      }
    });
    lifetimeCleanup.push(cleanupListener);

    if (tabType === 'ssh' && sshSessionId && sshShellReady) {
      const noticeAttempt = ++sshNoticeAttemptRef.current;
      publishSshNoticeState({ kind: 'waiting' });
      const dims = sshDimensions(fitAddon.proposeDimensions());
      const openShell = window.janet.sshCreateShell({
        id: sshSessionId,
        termId,
        cols: dims.cols,
        rows: dims.rows,
      });
      openShell.then(() => {
        if (!effectActive) return;
        onReady(termId);
        term.focus();
      }).catch((err: any) => {
        const message = err?.message || 'connection may have dropped';
        if (sshNoticeAttemptRef.current === noticeAttempt) {
          const errorState: SshNoticeState = { kind: 'error', message };
          publishSshNoticeState(errorState);
          term.write('\r\n\x1b[31mSSH shell failed to open: ' + message + '\x1b[0m\r\n');
        }
        if (effectActive) onReady(termId);
      });
    } else if (hasSession) {
      onReady(termId);
    } else if (tabType === 'local') {
      window.janet.terminalCreate({ id: termId, cwd: initialCwd }).then(() => {
        onReady(termId);
      }).catch(console.error);
    }


    const mountCleanup = attachTerminal(container, term, fitAddon, searchAddon, 100);

    if (tabType === 'local') {
      let lastReportedCwd: string | null = initialCwd || null;
      if (initialCwd) onCwdChange?.(termId, initialCwd);
      let cwdDebounce: ReturnType<typeof setTimeout> | null = null;
      const reportCwd = (newCwd: string) => {
        if (newCwd === lastReportedCwd) return;
        lastReportedCwd = newCwd;
        if (cwdDebounce) clearTimeout(cwdDebounce);
        cwdDebounce = setTimeout(() => onCwdChange?.(termId, newCwd), 80);
      };
      lifetimeCleanup.push(term.parser.registerOscHandler(7, (data) => {
        const path = fileUrlToPath(data);
        if (path) {
          // OSC 7 is emitted before every local shell prompt. Even when the
          // cwd is unchanged, the command that just completed may have
          // switched branches or changed files, so invalidate live UI data.
          refreshCoordinator.invalidate('prompt');
          reportCwd(path);
        }
        return true;
      }));
      lifetimeCleanup.push(() => { if (cwdDebounce) clearTimeout(cwdDebounce); });
    }
    terminalPaneCache.set(termId, {
      term,
      fitAddon,
      searchAddon,
      hasActiveSearch: false,
      cleanup: lifetimeCleanup,
      tabType,
      sshSessionId,
      sshShellReady,
      sshNoticeState: tabType !== 'ssh'
        ? { kind: 'hidden' }
        : sshShellReady
          ? { kind: 'waiting' }
          : { kind: 'reconnecting' },
      sshNoticeListener: setSshNoticeState,
      disposeTimer: null,
    });

    return () => {
      effectActive = false;
      runCleanup(mountCleanup);
      onRemoved(termId);
      scheduleCachedTerminalDispose(termId);
      const currentCache = terminalPaneCache.get(termId);
      if (currentCache?.sshNoticeListener === setSshNoticeState) {
        currentCache.sshNoticeListener = null;
      }
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
      const timer = setTimeout(() => {
        const term = termRef.current;
        const fitAddon = fitAddonRef.current;
        if (!term || !fitAddon) return;
        syncTerminalSize(term, fitAddon);
      }, 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [fontSize]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const retrySshShell = () => {
    if (!onSshRetry) return;
    const noticeAttempt = ++sshNoticeAttemptRef.current;
    const dimensions = sshDimensions(fitAddonRef.current?.proposeDimensions());
    publishSshNoticeState({ kind: 'reconnecting' });
    Promise.resolve(onSshRetry(termId, dimensions))
      .then(() => {
        if (sshNoticeAttemptRef.current !== noticeAttempt) return;
        publishSshNoticeState({ kind: 'waiting' });
      })
      .catch((err: any) => {
        if (sshNoticeAttemptRef.current !== noticeAttempt) return;
        publishSshNoticeState({ kind: 'error', message: err?.message || 'Reconnect failed' });
      });
  };

  return (
    <div className="terminal-container" ref={containerRef}>
      <SSHConnectionNotice
        state={sshNoticeState}
        label={sshSessionLabel}
        onDismiss={() => publishSshNoticeState({ kind: 'hidden' })}
        onRetry={onSshRetry ? retrySshShell : undefined}
      />
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
            clearSearchSelection();
          }
        }}
        onNext={() => doSearch(searchQuery, 'next')}
        onPrev={() => doSearch(searchQuery, 'prev')}
        onClose={closeSearch}
      />
    </div>
  );
}
