import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __test, getAccounts } from './api';

describe('accounts api caching behavior', () => {
  beforeEach(() => {
    __test.resetApiState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent identical account reads (reduced call count)', async () => {
    const payload = { ok: true, appId: 'APP1', items: [{ id: 'A1' }], count: 1 };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          if (name === 'ETag') return 'W/"etag-1"';
          if (name === 'Last-Modified') return 'Wed, 01 Jan 2025 00:00:00 GMT';
          return null;
        }
      },
      json: async () => payload
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const [a, b] = await Promise.all([
      getAccounts('APP1', undefined, undefined, 200),
      getAccounts('APP1', undefined, undefined, 200)
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(payload);
    expect(b).toEqual(payload);
  });

  it('reuses cached payload on 304 and sends conditional headers', async () => {
    const firstPayload = { ok: true, appId: 'APP2', items: [{ id: 'A2' }], count: 1 };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === 'ETag') return 'W/"etag-2"';
            if (name === 'Last-Modified') return 'Thu, 02 Jan 2025 00:00:00 GMT';
            return null;
          }
        },
        json: async () => firstPayload
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 304,
        headers: { get: () => null },
        json: async () => ({})
      });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const first = await getAccounts('APP2', undefined, undefined, 200);
    const second = await getAccounts('APP2', undefined, undefined, 200);

    expect(first).toEqual(firstPayload);
    expect(second).toEqual(firstPayload);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCallHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit)?.headers as Record<string, string>;
    expect(secondCallHeaders['If-None-Match']).toBe('W/"etag-2"');
    expect(secondCallHeaders['If-Modified-Since']).toBe('Thu, 02 Jan 2025 00:00:00 GMT');
  });
});
