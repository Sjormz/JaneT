import { describe, expect, it, vi } from 'vitest';
import { parseCommandNotificationPayload } from '../../src/shared/commandNotifications';

const validPayload = () => ({
  durationMs: 10_000,
  outcome: 'success',
  tabLabel: 'Build',
  paneLabel: 'Terminal',
  context: { kind: 'local' },
});

describe('command notification payload validation', () => {
  it('rejects payload and nested accessors without invoking them', () => {
    const payloadGetter = vi.fn(() => 10_000);
    const contextGetter = vi.fn(() => 'local');
    const accessorPayload = validPayload();
    Object.defineProperty(accessorPayload, 'durationMs', { enumerable: true, get: payloadGetter });
    const nestedAccessorPayload = { ...validPayload(), context: {} };
    Object.defineProperty(nestedAccessorPayload.context, 'kind', { enumerable: true, get: contextGetter });

    expect(parseCommandNotificationPayload(accessorPayload)).toBeNull();
    expect(parseCommandNotificationPayload(nestedAccessorPayload)).toBeNull();
    expect(payloadGetter).not.toHaveBeenCalled();
    expect(contextGetter).not.toHaveBeenCalled();
  });

  it('rejects custom, polluted, extra-key, and non-enumerable payload shapes', () => {
    const customPrototype = Object.assign(Object.create({ polluted: true }), validPayload());
    const customContext = { ...validPayload(), context: Object.assign(Object.create({ polluted: true }), { kind: 'local' }) };
    const nullPrototype = Object.assign(Object.create(null), validPayload());
    const extraKey = { ...validPayload(), command: 'secret' };
    const hiddenExtra = validPayload();
    Object.defineProperty(hiddenExtra, 'output', { value: 'secret' });

    expect(parseCommandNotificationPayload(customPrototype)).toBeNull();
    expect(parseCommandNotificationPayload(customContext)).toBeNull();
    expect(parseCommandNotificationPayload(extraKey)).toBeNull();
    expect(parseCommandNotificationPayload(hiddenExtra)).toBeNull();
    expect(parseCommandNotificationPayload(nullPrototype)).toEqual(validPayload());
  });

  it('contains throwing proxy-like payload and context values', () => {
    const throwingPayload = new Proxy(validPayload(), {
      getPrototypeOf() { throw new Error('payload trap'); },
    });
    const throwingContext = new Proxy({ kind: 'local' }, {
      ownKeys() { throw new Error('context trap'); },
    });

    expect(() => parseCommandNotificationPayload(throwingPayload)).not.toThrow();
    expect(parseCommandNotificationPayload(throwingPayload)).toBeNull();
    expect(() => parseCommandNotificationPayload({ ...validPayload(), context: throwingContext })).not.toThrow();
    expect(parseCommandNotificationPayload({ ...validPayload(), context: throwingContext })).toBeNull();
  });
});
