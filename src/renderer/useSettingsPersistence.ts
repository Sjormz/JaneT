import { useCallback, useRef, useState } from 'react';

/** Retain the latest unsaved values, including after a failed save or retry. */
export function useSettingsPersistence() {
  const pending = useRef<Record<string, unknown>>({});
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const persist = useCallback((updates: Record<string, unknown>) => {
    Object.assign(pending.current, updates);
    const save = async () => {
      const snapshot = { ...pending.current };
      if (!Object.keys(snapshot).length) return;
      setSaving(true);
      try {
        await window.janet.setSettings(snapshot);
        for (const key of Object.keys(snapshot)) {
          if (Object.is(pending.current[key], snapshot[key])) delete pending.current[key];
        }
        setError(false);
      } catch {
        setError(true);
      } finally {
        setSaving(false);
      }
    };
    queue.current = queue.current.then(save);
    return queue.current;
  }, []);
  return { persist, error, saving, retry: () => persist({}) };
}
