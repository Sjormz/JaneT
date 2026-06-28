import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import SearchOverlay from './SearchOverlay';
import { getTheme, ThemeName } from '../themes';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
  termId: string;
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  onReady: (termId: string) => void;
  onRemoved: (termId: string) => void;
  themeName?: string;
  fontSize?: number;
}

export default function TerminalPane({
  termId,
  tabType,
  sshSessionId,
  onReady,
  onRemoved,
  themeName,
  fontSize,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ resultIndex: 0, resultCount: 0 });

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

    // Create terminal session based on type
    if (tabType === 'local') {
      window.jterm.terminalCreate({ id: termId }).then(() => {
        onReady(termId);
      }).catch(console.error);
    } else if (tabType === 'ssh' && sshSessionId) {
      const dims = fitAddon.proposeDimensions();
      window.jterm.sshCreateShell({
        id: sshSessionId,
        termId,
        cols: dims?.cols || 80,
        rows: dims?.rows || 24,
      }).then(() => {
        onReady(termId);
      }).catch(console.error);
    }

    // Terminal input -> PTY
    const disposable = term.onData((data) => {
      if (tabType === 'local') {
        window.jterm.terminalWrite({ id: termId, data });
      } else if (tabType === 'ssh') {
        window.jterm.sshWriteShell({ termId, data });
      }
    });
    cleanupRef.current.push(() => disposable.dispose());

    // PTY output -> Terminal
    const cleanupListener = window.jterm.onTerminalData(({ id, data }) => {
      if (id === termId) {
        term.write(data);
      }
    });
    cleanupRef.current.push(cleanupListener);

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
              window.jterm.terminalResize({ id: termId, cols: dims.cols, rows: dims.rows });
            } else if (tabType === 'ssh') {
              window.jterm.sshResizeShell({ termId, cols: dims.cols, rows: dims.rows });
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
    container.addEventListener('click', () => term.focus());

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    return () => {
      cleanupRef.current.forEach((fn) => fn());
      cleanupRef.current = [];
      onRemoved(termId);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Keyboard shortcut handler for Ctrl+F / Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setSearchVisible((v) => !v);
      }
      if (e.key === 'Escape' && searchVisible) {
        closeSearch();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [searchVisible]);

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
