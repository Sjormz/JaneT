import type {
  AgentEventName,
  AgentLifecycleEvent,
  TurnOutcome,
} from './terminalAwareness';

const PREFIX = 'janet-agent';
const MAX_ENCODED_LENGTH = 8_192;
const MAX_ID_LENGTH = 256;
const PROVIDER = /^[a-z][a-z0-9-]{0,31}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const EVENTS = new Set<AgentEventName>([
  'session.start',
  'turn.start',
  'attention.request',
  'attention.resolve',
  'turn.end',
  'session.end',
]);
const OUTCOMES = new Set<TurnOutcome>(['succeeded', 'failed', 'interrupted']);
const BASE_KEYS = new Set(['version', 'event', 'sessionId', 'turnId', 'outcome']);

export type AgentOscDecodeResult = {
  recognized: boolean;
  event?: AgentLifecycleEvent;
};

function boundedId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function decodeBase64Url(value: string): string | null {
  if (!value || !BASE64URL.test(value) || value.length % 4 === 1) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeAgentOsc(data: string): AgentOscDecodeResult {
  const [prefix, provider, encoded, ...extra] = data.split(';');
  if (prefix !== PREFIX) return { recognized: false };
  if (
    extra.length > 0
    || !PROVIDER.test(provider ?? '')
    || typeof encoded !== 'string'
    || encoded.length > MAX_ENCODED_LENGTH
  ) {
    return { recognized: true };
  }

  const decoded = decodeBase64Url(encoded);
  if (decoded === null) return { recognized: true };

  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    return { recognized: true };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { recognized: true };

  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some((key) => !BASE_KEYS.has(key))
    || candidate.version !== 1
    || typeof candidate.event !== 'string'
    || !EVENTS.has(candidate.event as AgentEventName)
    || !boundedId(candidate.sessionId)
    || (candidate.turnId !== undefined && !boundedId(candidate.turnId))
  ) return { recognized: true };

  const event = candidate.event as AgentEventName;
  const isSessionEvent = event === 'session.start' || event === 'session.end';
  if (
    (isSessionEvent && (candidate.turnId !== undefined || candidate.outcome !== undefined))
    || (!isSessionEvent && !boundedId(candidate.turnId))
    || (event !== 'turn.end' && candidate.outcome !== undefined)
    || (event === 'turn.end' && !OUTCOMES.has(candidate.outcome as TurnOutcome))
  ) return { recognized: true };

  return {
    recognized: true,
    event: {
      version: 1,
      provider,
      event,
      sessionId: candidate.sessionId,
      ...(candidate.turnId ? { turnId: candidate.turnId } : {}),
      ...(event === 'turn.end' ? { outcome: candidate.outcome as TurnOutcome } : {}),
    },
  };
}
