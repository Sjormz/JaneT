import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  KeybindingAction,
  DEFAULT_KEYBINDINGS,
  matchesShortcut,
  formatShortcut,
} from './keybindings';

interface KeybindingsContextValue {
  /** Current keybinding map (action id → shortcut string) */
  bindings: Record<KeybindingAction, string>;
  /** Update a single keybinding */
  setBinding: (action: KeybindingAction, shortcut: string) => void;
  /** Reset all to defaults */
  resetDefaults: () => void;
  /** Check if an event matches a given action */
  matches: (e: KeyboardEvent, action: KeybindingAction) => boolean;
  /** Add a global keyboard listener that calls handler on matching action */
  on: (action: KeybindingAction, handler: () => void) => () => void;
  /** Start listening for a new shortcut (capture mode) — returns the captured shortcut */
  capture: (onCaptured: (shortcut: string) => void) => () => void;
}

const KeybindingsContext = createContext<KeybindingsContextValue | null>(null);

export function useKeybindings(): KeybindingsContextValue {
  const ctx = useContext(KeybindingsContext);
  if (!ctx) throw new Error('useKeybindings must be used within KeybindingsProvider');
  return ctx;
}

interface KeybindingsProviderProps {
  children: React.ReactNode;
  initialBindings?: Partial<Record<KeybindingAction, string>>;
  onSave?: (bindings: Record<KeybindingAction, string>) => void;
}

export function KeybindingsProvider({
  children,
  initialBindings,
  onSave,
}: KeybindingsProviderProps) {
  const [bindings, setBindings] = useState<Record<KeybindingAction, string>>(() => ({
    ...DEFAULT_KEYBINDINGS,
    ...initialBindings,
  }));

  // Keep track of registered global listeners
  const listenersRef = useRef<Map<KeybindingAction, Set<() => void>>>(new Map());
  const captureCallbackRef = useRef<((shortcut: string) => void) | null>(null);
  // Track bindings in a ref so the global listener always has latest
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const setBinding = useCallback((action: KeybindingAction, shortcut: string) => {
    setBindings((prev) => ({ ...prev, [action]: shortcut }));
  }, []);

  const resetDefaults = useCallback(() => {
    setBindings({ ...DEFAULT_KEYBINDINGS });
  }, []);

  const matches = useCallback(
    (e: KeyboardEvent, action: KeybindingAction) => {
      return matchesShortcut(e, bindings[action]);
    },
    [bindings],
  );

  const on = useCallback(
    (action: KeybindingAction, handler: () => void): (() => void) => {
      if (!listenersRef.current.has(action)) {
        listenersRef.current.set(action, new Set());
      }
      listenersRef.current.get(action)!.add(handler);
      return () => {
        listenersRef.current.get(action)?.delete(handler);
      };
    },
    [],
  );

  const capture = useCallback(
    (onCaptured: (shortcut: string) => void): (() => void) => {
      captureCallbackRef.current = onCaptured;
      return () => {
        captureCallbackRef.current = null;
      };
    },
    [],
  );

  // Persist binding changes
  useEffect(() => {
    if (onSave) {
      onSave(bindings);
    }
  }, [bindings, onSave]);

  // Global keydown listener for all registered actions + capture mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Capture mode — intercept first
      if (captureCallbackRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const shortcut = formatShortcut(e);
        captureCallbackRef.current(shortcut);
        captureCallbackRef.current = null;
        return;
      }

      // Modal surfaces own the keyboard while open. Suppressing application
      // shortcuts prevents a second action from mutating state behind a
      // confirmation or replacing the destructive target being reviewed.
      if (document.querySelector('[aria-modal="true"], [data-keybindings-suspended]')) return;

      // Xterm owns copy when it has a selection and Ctrl+C when it does not.
      // A user-rebound application action must not preempt either behavior.
      if (
        e.key.toLowerCase() === 'c'
        && (e.ctrlKey || e.metaKey)
        && !e.altKey
        && e.target instanceof Element
        && e.target.closest('.terminal-container')
      ) return;

      // Fire all registered handlers for matching actions
      const currentBindings = bindingsRef.current;
      for (const [action, handlerSet] of listenersRef.current.entries()) {
        if (matchesShortcut(e, currentBindings[action as KeybindingAction])) {
          e.preventDefault();
          e.stopPropagation();
          for (const fn of handlerSet) {
            fn();
          }
        }
      }
    };
    document.addEventListener('keydown', handler, true); // capture phase to get first crack
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  return (
    <KeybindingsContext.Provider value={{ bindings, setBinding, resetDefaults, matches, on, capture }}>
      {children}
    </KeybindingsContext.Provider>
  );
}
