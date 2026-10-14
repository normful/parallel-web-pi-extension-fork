import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isParallelAuthenticationError,
  runParallelExtract,
  runParallelSearch,
} from '../parallel-client.js';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runParallelSearch', () => {
  it('uses fast mode for interactive Pi searches', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            search_id: 'search_test',
            results: [],
            warnings: null,
            usage: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    await runParallelSearch('test-key', {
      objective: 'Find current Parallel Search documentation',
      search_queries: ['Parallel Search modes'],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.parallel.ai/v1/search');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      objective: 'Find current Parallel Search documentation',
      search_queries: ['Parallel Search modes'],
      mode: 'fast',
    });
  });
});

describe('PARALLEL_BASE_URL override', () => {
  afterEach(() => {
    delete process.env.PARALLEL_BASE_URL;
  });

  it('redirects web_search and web_fetch to the same origin as web_research', async () => {
    process.env.PARALLEL_BASE_URL = 'https://staging.parallel.test';
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await runParallelSearch('test-key', {
      objective: 'Find docs',
      search_queries: ['parallel docs'],
    }).catch(() => {});
    await runParallelExtract('test-key', {
      urls: ['https://parallel.ai/docs'],
    }).catch(() => {});

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://staging.parallel.test/v1/search',
      'https://staging.parallel.test/v1/extract',
    ]);
  });
});

describe('runParallelExtract', () => {
  const extractResponse = {
    extract_id: 'extract_test',
    session_id: 'session_test',
    errors: [],
    results: [
      {
        url: 'https://parallel.ai/docs',
        title: 'Parallel docs',
        excerpts: ['Focused excerpt about the authentication flow.'],
      },
    ],
    usage: [],
    warnings: null,
  };

  it('posts urls with the objective and search queries to /v1/extract', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(extractResponse));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runParallelExtract('test-key', {
      urls: ['https://parallel.ai/docs'],
      objective: 'Summarize the authentication flow',
      search_queries: ['parallel auth flow'],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.parallel.ai/v1/extract');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      urls: ['https://parallel.ai/docs'],
      objective: 'Summarize the authentication flow',
      search_queries: ['parallel auth flow'],
    });
    expect(result).toEqual(extractResponse);
  });

  it('does not force full_content when no objective or queries are given', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(extractResponse));
    vi.stubGlobal('fetch', fetchMock);

    await runParallelExtract('test-key', {
      urls: ['https://parallel.ai/docs'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ urls: ['https://parallel.ai/docs'] });
    expect(body).not.toHaveProperty('full_content');
    expect(body).not.toHaveProperty('mode');
  });

  it('forwards client_model and session_id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(extractResponse));
    vi.stubGlobal('fetch', fetchMock);

    await runParallelExtract('test-key', {
      urls: ['https://parallel.ai/docs'],
      client_model: 'gpt-5.4',
      session_id: 'session_abc',
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      urls: ['https://parallel.ai/docs'],
      client_model: 'gpt-5.4',
      session_id: 'session_abc',
    });
  });

  it('identifies the calling package in the request headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(extractResponse));
    vi.stubGlobal('fetch', fetchMock);

    await runParallelExtract('test-key', {
      urls: ['https://parallel.ai/docs'],
    });

    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get('X-Tool-Calling-Package')).toMatch(
      /^npm:@normful\/parallel-web-pi-extension\/v\d+\.\d+\.\d+$/
    );
    expect(headers.get('x-api-key')).toBe('test-key');
  });

  it('aborts the in-flight request when the caller signal aborts', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        expect(signal).toBeDefined();
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = runParallelExtract(
      'test-key',
      { urls: ['https://parallel.ai/docs'] },
      controller.signal
    );
    controller.abort();

    await expect(pending).rejects.toBeDefined();
  });

  it('surfaces authentication failures for the 401 error path', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Invalid API key' } }, 401)
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await runParallelExtract('bad-key', {
      urls: ['https://parallel.ai/docs'],
    }).catch((err: unknown) => err);

    expect(isParallelAuthenticationError(error)).toBe(true);
  });

  it('does not classify unrelated SDK failures as authentication errors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429)
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await runParallelExtract('test-key', {
      urls: ['https://parallel.ai/docs'],
    }).catch((err: unknown) => err);

    expect(isParallelAuthenticationError(error)).toBe(false);
  });
});

describe('isParallelAuthenticationError', () => {
  it('treats a non-Error throwable as unrelated', () => {
    expect(isParallelAuthenticationError('unauthorized')).toBe(false);
    expect(isParallelAuthenticationError(undefined)).toBe(false);
  });

  it('matches plain errors by name or by authentication wording', () => {
    const named = new Error('request failed');
    named.name = 'AuthenticationError';

    expect(isParallelAuthenticationError(named)).toBe(true);
    expect(
      isParallelAuthenticationError(new Error('Unauthorized: invalid api key'))
    ).toBe(true);
    expect(isParallelAuthenticationError(new Error('Socket closed'))).toBe(
      false
    );
  });
});
