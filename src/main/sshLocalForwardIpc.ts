type Handler = (event: unknown, payload: unknown) => unknown;
type Register = (channel: string, listener: Handler) => void;
type LocalForwardManager = Pick<import('./ssh').SSHManager,
  'startLocalForward' | 'stopLocalForward' | 'listLocalForwards'>;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function exactPlainEnvelope(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && 'value' in descriptor;
  });
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !CONTROL.test(value);
}

export function registerSSHLocalForwardHandlers(register: Register, manager: LocalForwardManager): void {
  register('ssh:startLocalForward', (_event, payload) => {
    if (!exactPlainEnvelope(payload, ['sessionId', 'request'])) throw new Error('Invalid SSH local-forward start payload');
    const sessionId = Object.getOwnPropertyDescriptor(payload, 'sessionId')!.value;
    const request = Object.getOwnPropertyDescriptor(payload, 'request')!.value;
    if (!boundedId(sessionId)) throw new Error('Invalid SSH local-forward start payload');
    return manager.startLocalForward(sessionId, request as Parameters<LocalForwardManager['startLocalForward']>[1]);
  });
  register('ssh:stopLocalForward', (_event, payload) => {
    if (!exactPlainEnvelope(payload, ['sessionId', 'id'])) throw new Error('Invalid SSH local-forward stop payload');
    const sessionId = Object.getOwnPropertyDescriptor(payload, 'sessionId')!.value;
    const id = Object.getOwnPropertyDescriptor(payload, 'id')!.value;
    if (!boundedId(sessionId) || !boundedId(id)) throw new Error('Invalid SSH local-forward stop payload');
    return manager.stopLocalForward(sessionId, id);
  });
  register('ssh:listLocalForwards', (_event, payload) => {
    if (!exactPlainEnvelope(payload, ['sessionId'])) throw new Error('Invalid SSH local-forward list payload');
    const sessionId = Object.getOwnPropertyDescriptor(payload, 'sessionId')!.value;
    if (!boundedId(sessionId)) throw new Error('Invalid SSH local-forward list payload');
    return manager.listLocalForwards(sessionId);
  });
}
