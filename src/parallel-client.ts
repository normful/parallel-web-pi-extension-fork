import Parallel from 'parallel-web';
import pkg from '../package.json' with { type: 'json' };

export interface ParallelSearchInput {
  objective: string;
  search_queries: string[];
  client_model?: string;
  session_id?: string;
}

export interface ParallelExtractInput {
  urls: string[];
  objective?: string;
  search_queries?: string[];
  client_model?: string;
  session_id?: string;
}

/** Documented limit on URLs per Extract call. */
export const MAX_EXTRACT_URLS = 20;

function createParallelClient(apiKey: string) {
  return new Parallel({
    apiKey,
    defaultHeaders: {
      'X-Tool-Calling-Package': `npm:@normful/parallel-web-pi-extension/v${pkg.version}`,
    },
  });
}

export async function runParallelSearch(
  apiKey: string,
  input: ParallelSearchInput,
  signal?: AbortSignal
) {
  const client = createParallelClient(apiKey);
  return await client.search(
    {
      objective: input.objective,
      search_queries: input.search_queries,
      mode: 'fast',
      client_model: input.client_model,
      session_id: input.session_id,
    },
    { signal }
  );
}

export async function runParallelExtract(
  apiKey: string,
  input: ParallelExtractInput,
  signal?: AbortSignal
) {
  const client = createParallelClient(apiKey);
  // Rely on the default excerpt behavior: with an objective/search_queries the
  // excerpts are focused on the relevant content; without them Extract returns
  // whole-page markdown. We intentionally do NOT force `full_content` — enabling
  // it without an objective/search_queries makes excerpts redundant (and the API
  // warns about it). See https://docs.parallel.ai/extract/best-practices.
  return await client.extract(
    {
      urls: input.urls,
      objective: input.objective,
      search_queries: input.search_queries,
      client_model: input.client_model,
      session_id: input.session_id,
    },
    { signal }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

/**
 * Shape check for the string lists both web tools take. Pi coerces raw values to
 * schema types before validation, so a `null` or a `0` would reach the API as the
 * words "null" or "0"; rejecting the raw value first avoids searching for it.
 */
function requireTextList(value: unknown, message: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(message);
  }
  return value.map((entry) => requireText(entry, message));
}

/**
 * Reject invalid raw `web_search` arguments before Pi coerces them to schema
 * types, and drop fields the tool does not send.
 */
export function parseSearchInput(input: unknown): ParallelSearchInput {
  if (!isRecord(input)) {
    throw new Error('Web search requires an objective and search queries.');
  }
  const objective = requireText(
    input.objective,
    'Web search requires a non-empty objective.'
  );
  const searchQueries = requireTextList(
    input.search_queries,
    'Web search requires a non-empty list of search queries.'
  );
  return { objective, search_queries: searchQueries };
}

function requireHttpUrl(value: unknown) {
  const url = requireText(value, 'Web fetch requires HTTP/HTTPS URLs.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Web fetch cannot read "${url}": not an absolute URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Web fetch cannot read "${url}": only HTTP and HTTPS URLs are supported.`
    );
  }
  return url;
}

/**
 * Reject invalid raw `web_fetch` arguments before Pi coerces them to schema
 * types, and drop fields the tool does not send.
 */
export function parseExtractInput(input: unknown): ParallelExtractInput {
  if (!isRecord(input)) {
    throw new Error('Web fetch requires a list of HTTP/HTTPS URLs.');
  }
  if (!Array.isArray(input.urls) || input.urls.length === 0) {
    throw new Error('Web fetch requires a non-empty list of HTTP/HTTPS URLs.');
  }
  if (input.urls.length > MAX_EXTRACT_URLS) {
    throw new Error(
      `Web fetch accepts at most ${MAX_EXTRACT_URLS} URLs per call; split the list.`
    );
  }
  const urls = input.urls.map(requireHttpUrl);
  const objective =
    input.objective === undefined
      ? undefined
      : requireText(input.objective, 'Web fetch objective must not be empty.');
  const searchQueries =
    input.search_queries === undefined
      ? undefined
      : requireTextList(
          input.search_queries,
          'Web fetch search queries must be a non-empty list of non-empty strings.'
        );
  return {
    urls,
    ...(objective === undefined ? {} : { objective }),
    ...(searchQueries === undefined ? {} : { search_queries: searchQueries }),
  };
}

export function isParallelAuthenticationError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: number }).status
      : undefined;

  return (
    status === 401 ||
    error.name === 'AuthenticationError' ||
    /unauthorized|authentication|api key/i.test(error.message)
  );
}
