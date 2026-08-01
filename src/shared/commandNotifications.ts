export interface CommandNotificationPayload {
  durationMs: number;
  outcome: 'success' | 'failure' | 'unknown';
  tabLabel: string;
  paneLabel: string;
  context: { kind: 'local' } | { kind: 'ssh'; hostLabel: string };
}

const PAYLOAD_KEYS = ['durationMs', 'outcome', 'tabLabel', 'paneLabel', 'context'] as const;
const LOCAL_CONTEXT_KEYS = ['kind'] as const;
const SSH_CONTEXT_KEYS = ['kind', 'hostLabel'] as const;

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
    const payload = ownDataValues(value, PAYLOAD_KEYS);
    if (!payload
      || !Number.isSafeInteger(payload.durationMs) || Number(payload.durationMs) < 0
      || !['success', 'failure', 'unknown'].includes(payload.outcome as string)
      || !boundedLabel(payload.tabLabel, 256) || !boundedLabel(payload.paneLabel, 256)) return null;

    const contextKeys = ownDataValues(payload.context, LOCAL_CONTEXT_KEYS);
    let context: CommandNotificationPayload['context'];
    if (contextKeys?.kind === 'local') {
      context = { kind: 'local' };
    } else {
      const sshContext = ownDataValues(payload.context, SSH_CONTEXT_KEYS);
      if (sshContext?.kind !== 'ssh' || !boundedLabel(sshContext.hostLabel, 512)) return null;
      context = { kind: 'ssh', hostLabel: sshContext.hostLabel as string };
    }

    return {
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
