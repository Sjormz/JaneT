export interface CommandNotificationPayload {
  target?: { tabId: string; termId: string };
  codexEvent?: 'needs-input' | 'turn-complete';
  durationMs: number;
  outcome: 'success' | 'failure' | 'unknown';
  tabLabel: string;
  paneLabel: string;
  context: { kind: 'local' };
}

const PAYLOAD_KEYS = ['durationMs', 'outcome', 'tabLabel', 'paneLabel', 'context'] as const;
const LOCAL_CONTEXT_KEYS = ['kind'] as const;

function ownDataValues(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

const boundedLabel = (value: unknown, maximum: number) => typeof value === 'string' && value.length > 0 && value.length <= maximum;

export function parseCommandNotificationPayload(value: unknown): CommandNotificationPayload | null {
  try {
    const payload = ownDataValues(value, PAYLOAD_KEYS) ?? ownDataValues(value, [...PAYLOAD_KEYS, 'target'])
      ?? ownDataValues(value, [...PAYLOAD_KEYS, 'codexEvent'])
      ?? ownDataValues(value, [...PAYLOAD_KEYS, 'target', 'codexEvent']);
    if (!payload
      || !Number.isSafeInteger(payload.durationMs) || Number(payload.durationMs) < 0
      || !['success', 'failure', 'unknown'].includes(payload.outcome as string)
      || (payload.codexEvent !== undefined && !['needs-input', 'turn-complete'].includes(payload.codexEvent as string))
      || !boundedLabel(payload.tabLabel, 256) || !boundedLabel(payload.paneLabel, 256)) return null;

    const contextKeys = ownDataValues(payload.context, LOCAL_CONTEXT_KEYS);
    if (contextKeys?.kind !== 'local') return null;
    const context: CommandNotificationPayload['context'] = { kind: 'local' };

    let target: CommandNotificationPayload['target'];
    if (payload.target !== undefined) {
      const ids = ownDataValues(payload.target, ['tabId', 'termId']);
      if (!ids || !boundedLabel(ids.tabId, 256) || !boundedLabel(ids.termId, 256)
        || /[\u0000-\u001f\u007f]/.test(String(ids.tabId) + String(ids.termId))) return null;
      target = { tabId: ids.tabId as string, termId: ids.termId as string };
    }
    return {
      ...(target ? { target } : {}),
      ...(payload.codexEvent ? { codexEvent: payload.codexEvent as CommandNotificationPayload['codexEvent'] } : {}),
      durationMs: payload.durationMs as number,
      outcome: payload.outcome as CommandNotificationPayload['outcome'],
      tabLabel: payload.tabLabel as string,
      paneLabel: payload.paneLabel as string,
      context,
    };
  } catch {
    return null;
  }
}

export function isCommandNotificationPayload(value: unknown): value is CommandNotificationPayload {
  return parseCommandNotificationPayload(value) !== null;
}
