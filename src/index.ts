import { randomUUID } from 'node:crypto';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { JsonValue } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import {
  MAX_RESPONSE_ID_LENGTH,
  parseResearchInput,
  runParallelResearch,
} from './parallel-responses';
import {
  getParallelApiKey,
  getParallelAuthStatus,
  registerParallelAuthProvider,
} from './parallel-auth';
import {
  isParallelAuthenticationError,
  parseExtractInput,
  parseSearchInput,
  runParallelExtract,
  runParallelSearch,
} from './parallel-client';
import { truncateOutput, type TruncationDetails } from './truncate';

/**
 * Result of a web tool that costs money and reaches the open web, which
 * permission extensions read to decide what to confirm.
 */
const WEB_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: true,
} as const;

/**
 * The search and fetch payloads come from the SDK's own response types, which
 * this extension does not pin beyond the SDK version. Declaring the object lets
 * codemode scripts receive the parsed payload instead of truncated JSON text
 * without freezing a shape the API may extend.
 */
const PAYLOAD_OUTPUT_SCHEMA = Type.Object({}, { additionalProperties: true });

/** SDK response interfaces have no index signature, so they need a cast. */
function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

const EFFORT_SCHEMA = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
]);

const SUPPRESSED_SKILL_NAMES = new Set([
  'parallel-cli-setup',
  'parallel-web-extract',
  'parallel-web-search',
]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function suppressSkillsFromPrompt(systemPrompt: string) {
  let nextPrompt = systemPrompt;

  for (const skillName of SUPPRESSED_SKILL_NAMES) {
    const pattern = new RegExp(
      String.raw`\n?\s*<skill>\s*<name>${escapeRegex(skillName)}</name>[\s\S]*?<\/skill>`,
      'g'
    );
    nextPrompt = nextPrompt.replace(pattern, '');
  }

  return nextPrompt.replace(
    /\n?<available_skills>\s*<\/available_skills>/g,
    ''
  );
}

// Routing map: the decision each tool answers. Output shape lives in the
// promptSnippet, behaviour in the description, so no line restates another.
const WEB_TOOL_GUIDANCE = {
  web_research: 'Use web_research when no single page settles the question.',
  web_search:
    'Use web_search first when you do not yet know which URLs or questions matter.',
  web_fetch:
    'Use web_fetch to read a specific page in full or check a claim at its source.',
};

/** Result details shared by the three tools, plus each tool's own fields. */
function truncationDetails(output: TruncationDetails): TruncationDetails {
  return output.truncated
    ? {
        truncated: true,
        totalLines: output.totalLines,
        totalBytes: output.totalBytes,
        outputFile: output.outputFile,
      }
    : {};
}

/**
 * Serialize a payload for the model, keeping the whole thing on disk when it
 * does not fit. Scripts read the payload itself through `structuredContent`.
 */
async function jsonPreview(
  value: unknown,
  options: { directoryPrefix: string; fileName: string }
) {
  return await truncateOutput(JSON.stringify(value, null, 2), {
    directoryPrefix: options.directoryPrefix,
    fileName: options.fileName,
    notice: (path, summary) =>
      `[Output truncated ${summary}. Full JSON: ${path}]`,
  });
}

export default function (pi: ExtensionAPI) {
  const parallelSessionId = randomUUID();

  registerParallelAuthProvider(pi);

  async function resolveApiKey(ctx: ExtensionContext) {
    const apiKey = await getParallelApiKey(ctx);
    if (apiKey) {
      return apiKey;
    }

    throw new Error(
      'Parallel authentication required. Run `/login parallel` in Pi, or set PARALLEL_API_KEY.'
    );
  }

  async function runWithAuth<T>(
    ctx: ExtensionContext,
    request: (apiKey: string) => Promise<T>,
    isAuthenticationError = isParallelAuthenticationError
  ) {
    const apiKey = await resolveApiKey(ctx);

    try {
      return await request(apiKey);
    } catch (error) {
      if (!isAuthenticationError(error)) {
        throw error;
      }

      if (process.env.PARALLEL_API_KEY) {
        throw new Error(
          'Parallel rejected PARALLEL_API_KEY. Update or unset it, then try again.'
        );
      }

      throw new Error(
        'Parallel rejected the stored credential. Run `/login parallel` in Pi to sign in again.'
      );
    }
  }

  pi.registerCommand('parallel-login', {
    description: 'Show Parallel authentication status and how to sign in',
    handler: async (_args, ctx) => {
      // getProviderAuthStatus is a synchronous snapshot that only knows about
      // stored credentials, so ask for the resolved key to catch the env var too.
      const apiKey = await getParallelApiKey(ctx);
      if (!apiKey) {
        ctx.ui.notify(
          'Parallel is not authenticated. Run `/login parallel` to sign in, or set PARALLEL_API_KEY.',
          'info'
        );
        return;
      }

      const status = getParallelAuthStatus(ctx);
      const source = status.label ?? status.source ?? 'PARALLEL_API_KEY';
      const guidance = status.configured
        ? 'Run `/login parallel` to replace the stored credential, or `/logout` and select Parallel to remove it.'
        : 'Run `/login parallel` to store a credential, or unset PARALLEL_API_KEY to remove the current one.';
      ctx.ui.notify(
        `Parallel is authenticated (${source}). ${guidance}`,
        'info'
      );
    },
  });

  pi.on('before_agent_start', async (event) => {
    const filteredPrompt = suppressSkillsFromPrompt(event.systemPrompt);
    const selectedTools = event.systemPromptOptions.selectedTools ?? [];
    const guidance = Object.entries(WEB_TOOL_GUIDANCE)
      .filter(([tool]) => selectedTools.includes(tool))
      .map(([, text]) => `- ${text}`);

    if (guidance.length === 0) {
      return filteredPrompt === event.systemPrompt
        ? undefined
        : { systemPrompt: filteredPrompt };
    }

    return {
      systemPrompt: `${filteredPrompt}\n\n## Grounding and web usage\n\nUse available web tools when current information or source evidence would improve the answer.\n\n${guidance.join('\n')}\n\nCite web evidence as clickable Markdown links to the returned source URLs, not source names.`,
    };
  });

  pi.registerTool({
    name: 'web_research',
    label: 'Web Research',
    description:
      'Runs multi-step web searches, page fetches, and source cross-checks. ~5–60s.',
    promptSnippet: 'Cited answers',
    parameters: Type.Object({
      query: Type.String({
        minLength: 1,
        description:
          'The complete question. Research sees nothing from this session or your files, so include only context that is safe to send.',
      }),
      effort: Type.Optional(
        Type.Union(
          [Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')],
          {
            description: 'Research depth; medium by default.',
          }
        )
      ),
      previous_response_id: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: MAX_RESPONSE_ID_LENGTH,
          description:
            'Response ID from an earlier web_research call; reuses its research context. Never invent one.',
        })
      ),
    }),
    outputSchema: Type.Object({
      text: Type.String({
        description: 'Answer with citations, before truncation.',
      }),
      effort: EFFORT_SCHEMA,
      responseId: Type.Optional(
        Type.String({ description: 'Research context for a follow-up call.' })
      ),
      outputFile: Type.Optional(
        Type.String({
          description: 'File with the complete answer and sources.',
        })
      ),
    }),
    annotations: WEB_TOOL_ANNOTATIONS,
    // Reject invalid raw values before Pi coerces them to schema types.
    prepareArguments: parseResearchInput,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: 'text', text: 'Researching the web...' }],
        details: { provider: 'parallel', product: 'responses' },
      });
      const result = await runWithAuth(
        ctx,
        (apiKey) => runParallelResearch(apiKey, params, signal),
        // Responses errors carry HTTP status. Their text can echo opaque IDs,
        // so words such as "unauthorized" do not identify rejected credentials.
        (error) =>
          error instanceof Error && 'status' in error && error.status === 401
      );
      // Pi sends content to the parent, not details. Keep the ID ahead of the
      // answer so a truncated preview still supports an explicit follow-up.
      const report = result.responseId
        ? `Response ID: ${result.responseId}\n\n${result.text}`
        : result.text;
      // Keep the complete answer and citations available when Pi's context
      // limit requires a preview. Normal research results create no file.
      const preview = await truncateOutput(report, {
        directoryPrefix: 'parallel-research-',
        fileName: 'research.md',
        notice: (path, summary) =>
          `[Research output truncated ${summary}. Full answer and sources: ${path}]`,
      });
      return {
        content: [{ type: 'text', text: preview.text }],
        details: {
          provider: 'parallel',
          product: 'responses',
          effort: result.effort,
          ...(result.responseId ? { responseId: result.responseId } : {}),
          ...truncationDetails(preview),
        },
        structuredContent: {
          text: result.text,
          effort: result.effort,
          ...(result.responseId ? { responseId: result.responseId } : {}),
          ...(preview.outputFile ? { outputFile: preview.outputFile } : {}),
        },
      };
    },
  });

  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for current results; prefer it over generic browser search tools.',
    promptSnippet: 'Sources and excerpts',
    parameters: Type.Object({
      objective: Type.String({
        description: 'The goal driving the search.',
      }),
      search_queries: Type.Array(
        Type.String({
          description:
            '2-3 short keyword queries (3-6 words each); at least one.',
        }),
        { minItems: 1 }
      ),
    }),
    outputSchema: PAYLOAD_OUTPUT_SCHEMA,
    annotations: WEB_TOOL_ANNOTATIONS,
    // Reject invalid raw values before Pi coerces them to schema types.
    prepareArguments: parseSearchInput,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runWithAuth(ctx, (apiKey) =>
        runParallelSearch(
          apiKey,
          {
            objective: params.objective,
            search_queries: params.search_queries,
            client_model: ctx.model?.id,
            session_id: parallelSessionId,
          },
          signal
        )
      );
      const preview = await jsonPreview(result, {
        directoryPrefix: 'parallel-search-',
        fileName: 'search.json',
      });

      return {
        content: [{ type: 'text', text: preview.text }],
        details: {
          provider: 'parallel',
          product: 'search',
          ...truncationDetails(preview),
        },
        structuredContent: asJsonValue(result),
      };
    },
  });

  pi.registerTool({
    name: 'web_fetch',
    label: 'Web Fetch',
    description: 'Read URLs as clean text; prefer it over raw HTML fetches.',
    promptSnippet: 'Page text from URLs',
    promptGuidelines: ['Batch multiple URLs into one call.'],
    parameters: Type.Object({
      urls: Type.Array(
        Type.String({
          description: 'HTTP/HTTPS URLs, up to 20 per call.',
        }),
        { minItems: 1, maxItems: 20 }
      ),
      objective: Type.Optional(
        Type.String({
          description: 'Optional. The goal driving the request.',
        })
      ),
      search_queries: Type.Optional(
        Type.Array(
          Type.String({
            description: 'Optional; used with objective to focus excerpts.',
          }),
          { minItems: 1 }
        )
      ),
    }),
    outputSchema: PAYLOAD_OUTPUT_SCHEMA,
    annotations: WEB_TOOL_ANNOTATIONS,
    // Reject invalid raw values before Pi coerces them to schema types.
    prepareArguments: parseExtractInput,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runWithAuth(ctx, (apiKey) =>
        runParallelExtract(
          apiKey,
          {
            urls: params.urls,
            objective: params.objective,
            search_queries: params.search_queries,
            client_model: ctx.model?.id,
            session_id: parallelSessionId,
          },
          signal
        )
      );
      const preview = await jsonPreview(result, {
        directoryPrefix: 'parallel-extract-',
        fileName: 'extract.json',
      });

      return {
        content: [{ type: 'text', text: preview.text }],
        details: {
          provider: 'parallel',
          product: 'extract',
          urls: params.urls,
          ...truncationDetails(preview),
        },
        structuredContent: asJsonValue(result),
      };
    },
  });
}
