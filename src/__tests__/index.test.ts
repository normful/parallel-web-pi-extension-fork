import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateToolArguments } from '@earendil-works/pi-ai';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from '@earendil-works/pi-coding-agent';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';

const mocks = vi.hoisted(() => ({
  getParallelApiKey: vi.fn(),
  getParallelAuthStatus: vi.fn(),
  registerParallelAuthProvider: vi.fn(),
  runParallelSearch: vi.fn(),
  runParallelExtract: vi.fn(),
  runParallelResearch: vi.fn(),
  isParallelAuthenticationError: vi.fn(),
}));

vi.mock('../parallel-auth.js', () => ({
  getParallelApiKey: mocks.getParallelApiKey,
  getParallelAuthStatus: mocks.getParallelAuthStatus,
  registerParallelAuthProvider: mocks.registerParallelAuthProvider,
}));

vi.mock('../parallel-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../parallel-client.js')>()),
  runParallelSearch: mocks.runParallelSearch,
  runParallelExtract: mocks.runParallelExtract,
  isParallelAuthenticationError: mocks.isParallelAuthenticationError,
}));

vi.mock('../parallel-responses.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../parallel-responses.js')>()),
  runParallelResearch: mocks.runParallelResearch,
}));

type MockPi = {
  on: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  registerProvider: ReturnType<typeof vi.fn>;
};

function createMockPi(): MockPi {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    registerProvider: vi.fn(),
  };
}

function getRegisteredCommand(pi: MockPi, name: string) {
  return pi.registerCommand.mock.calls.find(
    ([commandName]) => commandName === name
  )?.[1];
}

function getEventHandler(pi: MockPi, eventName: string) {
  return pi.on.mock.calls.find(([name]) => name === eventName)?.[1];
}

function getRegisteredTool(pi: MockPi, name: string) {
  return pi.registerTool.mock.calls
    .map(([tool]) => tool)
    .find((tool) => tool.name === name);
}

function createToolContext(overrides: Record<string, unknown> = {}) {
  return {
    hasUI: false,
    ui: {
      confirm: vi.fn(),
      notify: vi.fn(),
      input: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

describe('@normful/parallel-web-pi-extension', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PARALLEL_API_KEY;
    mocks.isParallelAuthenticationError.mockReturnValue(false);
  });

  it('should export the extension as default', async () => {
    const module = await import('../index.js');
    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
  });

  it('registers research as a normal tool without another package', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);
    expect(getRegisteredTool(pi, 'web_research')).toEqual(
      expect.objectContaining({
        name: 'web_research',
        execute: expect.any(Function),
      })
    );
  });

  it('should register the login command and web tools', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();

    extension(pi as unknown as ExtensionAPI);

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      'parallel-login',
      expect.objectContaining({
        description: 'Show Parallel authentication status and how to sign in',
        handler: expect.any(Function),
      })
    );

    expect(pi.registerTool).toHaveBeenCalledTimes(3);

    const searchTool = getRegisteredTool(pi, 'web_search');
    expect(searchTool).toEqual(
      expect.objectContaining({
        name: 'web_search',
        label: 'Web Search',
        description: expect.stringContaining('Search the web for current'),
        promptSnippet: 'Sources and excerpts',
        execute: expect.any(Function),
      })
    );

    const fetchTool = getRegisteredTool(pi, 'web_fetch');
    expect(fetchTool).toEqual(
      expect.objectContaining({
        name: 'web_fetch',
        label: 'Web Fetch',
        description: expect.stringContaining('Read URLs as clean text'),
        promptSnippet: 'Page text from URLs',
        promptGuidelines: ['Batch multiple URLs into one call.'],
        execute: expect.any(Function),
      })
    );
  });

  it('describes the tools generically, without naming the provider', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const modelFacingText = pi.registerTool.mock.calls.flatMap(([tool]) => [
      tool.description,
      tool.promptSnippet,
      ...(tool.promptGuidelines ?? []),
      ...Object.values(tool.parameters?.properties ?? {}).flatMap((schema) => {
        const anySchema = schema as { description?: string; items?: unknown };
        const items = anySchema.items as { description?: string } | undefined;
        return [anySchema.description, items?.description];
      }),
    ]);

    // The routing block is system-prompt text too, so it is held to the rule.
    const handler = getEventHandler(pi, 'before_agent_start');
    const injected = await handler({
      systemPrompt: 'Base prompt',
      systemPromptOptions: {
        selectedTools: ['web_research', 'web_search', 'web_fetch'],
      },
    });
    modelFacingText.push(injected.systemPrompt);

    expect(modelFacingText.length).toBeGreaterThan(0);
    for (const text of modelFacingText) {
      expect(text ?? '').not.toMatch(/parallel/i);
    }
  });

  it('should append web grounding guidance to the system prompt when web tools are active', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const handler = getEventHandler(pi, 'before_agent_start');
    const result = await handler({
      systemPrompt: 'Base system prompt',
      systemPromptOptions: {
        selectedTools: ['web_search', 'read'],
      },
    });

    expect(result).toEqual({
      systemPrompt: expect.stringContaining('Base system prompt'),
    });
    expect(result.systemPrompt).toContain('Grounding and web usage');
    expect(result.systemPrompt).toContain('Use web_search');
    expect(result.systemPrompt).not.toContain('Use web_fetch');
    expect(result.systemPrompt).not.toContain('Use web_research');
  });

  it('exposes routing guidance only for active web tools', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);
    const handler = getEventHandler(pi, 'before_agent_start');
    const all = await handler({
      systemPrompt: 'Base prompt',
      systemPromptOptions: {
        selectedTools: ['web_research', 'web_search', 'web_fetch'],
      },
    });
    expect(all.systemPrompt).toContain('Use web_research when no single page');
    expect(all.systemPrompt).toContain('Use web_search first');
    expect(all.systemPrompt).toContain('Use web_fetch to read a specific page');
    expect(all.systemPrompt).toContain(
      'clickable Markdown links to the returned source URLs'
    );
    const researchOnly = await handler({
      systemPrompt: 'Base prompt',
      systemPromptOptions: { selectedTools: ['web_research'] },
    });
    expect(researchOnly.systemPrompt).toContain('Use web_research');
    expect(researchOnly.systemPrompt).not.toContain('Use web_search');
    expect(researchOnly.systemPrompt).not.toContain('Use web_fetch');
    expect(
      await handler({
        systemPrompt: 'Base prompt',
        systemPromptOptions: { selectedTools: ['read'] },
      })
    ).toBeUndefined();
  });

  it('should suppress overlapping Parallel skills from the system prompt', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const handler = getEventHandler(pi, 'before_agent_start');
    const result = await handler({
      systemPrompt: `Base system prompt
<available_skills>
  <skill>
    <name>parallel-web-search</name>
    <description>Search skill</description>
  </skill>
  <skill>
    <name>parallel-cli-setup</name>
    <description>Setup skill</description>
  </skill>
  <skill>
    <name>result</name>
    <description>Allowed skill</description>
  </skill>
</available_skills>`,
      systemPromptOptions: {
        selectedTools: ['read'],
      },
    });

    expect(result.systemPrompt).not.toContain(
      '<name>parallel-web-search</name>'
    );
    expect(result.systemPrompt).not.toContain(
      '<name>parallel-cli-setup</name>'
    );
    expect(result.systemPrompt).toContain('<name>result</name>');
  });

  it('should register the Parallel auth provider with Pi', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();

    extension(pi as unknown as ExtensionAPI);

    expect(mocks.registerParallelAuthProvider).toHaveBeenCalledWith(pi);
  });

  it('parallel-login should point at /login parallel when unauthenticated', async () => {
    mocks.getParallelApiKey.mockResolvedValue(undefined);
    mocks.getParallelAuthStatus.mockReturnValue({ configured: false });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const command = getRegisteredCommand(pi, 'parallel-login');
    const ctx = createToolContext();

    await command.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('/login parallel'),
      'info'
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('not authenticated'),
      'info'
    );
  });

  it('parallel-login should report the credential source when authenticated', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.getParallelAuthStatus.mockReturnValue({
      configured: true,
      source: 'stored',
    });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const command = getRegisteredCommand(pi, 'parallel-login');
    const ctx = createToolContext();

    await command.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('authenticated (stored)'),
      'info'
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('`/logout` and select Parallel'),
      'info'
    );
  });

  it('parallel-login should recognize a key that only PARALLEL_API_KEY provides', async () => {
    // getProviderAuthStatus only sees stored credentials, so an env-var-only
    // setup reports unconfigured even though the key resolves fine.
    mocks.getParallelApiKey.mockResolvedValue('env-api-key');
    mocks.getParallelAuthStatus.mockReturnValue({ configured: false });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const command = getRegisteredCommand(pi, 'parallel-login');
    const ctx = createToolContext();

    await command.handler([], ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('authenticated (PARALLEL_API_KEY)'),
      'info'
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('unset PARALLEL_API_KEY'),
      'info'
    );
  });

  it('web_search should use the stored api key when available', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelSearch.mockResolvedValue({
      results: [{ title: 'Example' }],
    });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');
    const result = await searchTool.execute(
      'tool-call-id',
      {
        objective: 'Find current AI news',
        search_queries: ['ai news', 'llm updates'],
      },
      undefined,
      undefined,
      createToolContext()
    );

    expect(mocks.runParallelSearch).toHaveBeenCalledWith(
      'stored-api-key',
      {
        objective: 'Find current AI news',
        search_queries: ['ai news', 'llm updates'],
        client_model: undefined,
        session_id: expect.any(String),
      },
      undefined
    );
    expect(result.content[0].text).toBe(
      JSON.stringify({ results: [{ title: 'Example' }] }, null, 2)
    );
  });

  it('web_search should direct the user to /login parallel when no credentials are present', async () => {
    mocks.getParallelApiKey.mockResolvedValue(undefined);

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');

    await expect(
      searchTool.execute(
        'tool-call-id',
        { objective: 'Find docs', search_queries: ['parallel docs'] },
        undefined,
        undefined,
        createToolContext({ hasUI: true })
      )
    ).rejects.toThrow(
      'Parallel authentication required. Run `/login parallel` in Pi, or set PARALLEL_API_KEY.'
    );

    expect(mocks.runParallelSearch).not.toHaveBeenCalled();
  });

  it('web_search should direct the user to re-login when the stored credential is rejected', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stale-api-key');
    mocks.isParallelAuthenticationError.mockReturnValue(true);
    mocks.runParallelSearch.mockRejectedValue(new Error('unauthorized'));

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');

    await expect(
      searchTool.execute(
        'tool-call-id',
        { objective: 'Find docs', search_queries: ['parallel docs'] },
        undefined,
        undefined,
        createToolContext({ hasUI: true })
      )
    ).rejects.toThrow(
      'Parallel rejected the stored credential. Run `/login parallel` in Pi to sign in again.'
    );

    expect(mocks.runParallelSearch).toHaveBeenCalledTimes(1);
  });

  it('web_search should reject invalid PARALLEL_API_KEY values clearly', async () => {
    process.env.PARALLEL_API_KEY = 'bad-key';
    mocks.getParallelApiKey.mockResolvedValue('bad-key');
    mocks.isParallelAuthenticationError.mockReturnValue(true);
    mocks.runParallelSearch.mockRejectedValue(new Error('unauthorized'));

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');

    await expect(
      searchTool.execute(
        'tool-call-id',
        { objective: 'Find docs', search_queries: ['parallel docs'] },
        undefined,
        undefined,
        createToolContext({ hasUI: true })
      )
    ).rejects.toThrow(
      'Parallel rejected PARALLEL_API_KEY. Update or unset it, then try again.'
    );
  });

  it('web_fetch should pass through the objective when provided', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelExtract.mockResolvedValue({
      url: 'https://parallel.ai/docs',
    });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const fetchTool = getRegisteredTool(pi, 'web_fetch');
    const result = await fetchTool.execute(
      'tool-call-id',
      {
        urls: ['https://parallel.ai/docs', 'https://parallel.ai/blog'],
        objective: 'Summarize the authentication flow',
        search_queries: ['parallel auth flow'],
      },
      undefined,
      undefined,
      createToolContext()
    );

    expect(mocks.runParallelExtract).toHaveBeenCalledWith(
      'stored-api-key',
      {
        urls: ['https://parallel.ai/docs', 'https://parallel.ai/blog'],
        objective: 'Summarize the authentication flow',
        search_queries: ['parallel auth flow'],
        client_model: undefined,
        session_id: expect.any(String),
      },
      undefined
    );
    expect(result.details).toEqual({
      provider: 'parallel',
      product: 'extract',
      urls: ['https://parallel.ai/docs', 'https://parallel.ai/blog'],
      results: 0,
      errors: 0,
      warnings: 0,
    });
  });

  it('tool results should be truncated when the sdk returns large payloads', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelSearch.mockResolvedValue({
      items: Array.from({ length: 5000 }, (_, index) => `result-${index}`),
    });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');
    const result = await searchTool.execute(
      'tool-call-id',
      { objective: 'Find many results', search_queries: ['many results'] },
      undefined,
      undefined,
      createToolContext()
    );

    expect(result.content[0].text).toContain('[Output truncated at the');
  });

  it('should forward the active model id as client_model', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelSearch.mockResolvedValue({ ok: true });

    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');
    await searchTool.execute(
      'tool-call-id',
      { objective: 'Find docs', search_queries: ['parallel docs'] },
      undefined,
      undefined,
      createToolContext({ model: { id: 'gpt-5.4' } })
    );

    expect(mocks.runParallelSearch).toHaveBeenCalledWith(
      'stored-api-key',
      expect.objectContaining({
        client_model: 'gpt-5.4',
      }),
      undefined
    );
  });
  it.each([null, 0, false])(
    'web_research rejects a %j query before Pi can coerce it to a string',
    async (query) => {
      mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
      mocks.runParallelResearch.mockResolvedValue({
        text: 'This request should not have been sent.',
        effort: 'medium',
      });
      const extension = (await import('../index.js')).default;
      const pi = createMockPi();
      extension(pi as unknown as ExtensionAPI);
      const tool = getRegisteredTool(pi, 'web_research');

      const execute = async () => {
        const args = tool.prepareArguments?.({ query }) ?? { query };
        const params = validateToolArguments(tool, {
          type: 'toolCall',
          id: 'research-invalid',
          name: 'web_research',
          arguments: args,
        });
        return await tool.execute(
          'research-invalid',
          params,
          undefined,
          undefined,
          createToolContext()
        );
      };

      await expect(execute()).rejects.toThrow('non-empty question');
      expect(mocks.runParallelResearch).not.toHaveBeenCalled();
    }
  );

  it.each([null, 42, false, {}, [], '', ' ', 'resp_\n', 'x'.repeat(513)])(
    'web_research rejects raw invalid continuation IDs before Pi coercion: %j',
    async (previous_response_id) => {
      const extension = (await import('../index.js')).default;
      const pi = createMockPi();
      extension(pi as unknown as ExtensionAPI);
      const tool = getRegisteredTool(pi, 'web_research');
      expect(() => {
        const args = tool.prepareArguments({
          query: 'A follow-up',
          previous_response_id,
        });
        validateToolArguments(tool, {
          type: 'toolCall',
          id: 'invalid-followup',
          name: 'web_research',
          arguments: args,
        });
      }).toThrow('previous_response_id');
      expect(mocks.getParallelApiKey).not.toHaveBeenCalled();
      expect(mocks.runParallelResearch).not.toHaveBeenCalled();
    }
  );

  it('web_research exposes continuation IDs to the parent and forwards only the explicit ID', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    const answer = '    const answer = 42;\n\n[source](https://example.com)\n';
    mocks.runParallelResearch.mockResolvedValue({
      text: answer,
      effort: 'medium',
      responseId: 'resp_next',
    });
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);
    const tool = getRegisteredTool(pi, 'web_research');
    expect(tool.parameters.required).not.toContain('previous_response_id');
    expect(tool.parameters.properties.previous_response_id).toMatchObject({
      type: 'string',
      maxLength: 512,
    });
    // Continuation must be discoverable from the parameter the model sets.
    expect(
      tool.parameters.properties.previous_response_id.description
    ).toContain('earlier web_research call');
    const args = tool.prepareArguments({
      query: 'A focused follow-up',
      previous_response_id: 'resp_prior',
      history: 'private-history',
    });
    const params = validateToolArguments(tool, {
      type: 'toolCall',
      id: 'followup',
      name: 'web_research',
      arguments: args,
    });
    const signal = new AbortController().signal;
    const result = await tool.execute(
      'followup',
      params,
      signal,
      undefined,
      createToolContext()
    );
    expect(mocks.runParallelResearch).toHaveBeenCalledWith(
      'stored-api-key',
      {
        query: 'A focused follow-up',
        effort: 'medium',
        previous_response_id: 'resp_prior',
      },
      signal
    );
    expect(result.content).toEqual([
      { type: 'text', text: `Response ID: resp_next\n\n${answer}` },
    ]);
    expect(result.details.responseId).toBe('resp_next');
    expect(result.details.outputFile).toBeUndefined();
  });

  it('web_research uses shared auth and sends only explicit arguments with cancellation', async () => {
    const { runParallelResearch } = await vi.importActual<
      typeof import('../parallel-responses.js')
    >('../parallel-responses.js');
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelResearch.mockImplementationOnce(runParallelResearch);
    const answer = 'Answer with [source](https://example.com)';
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: answer }],
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);
    const tool = getRegisteredTool(pi, 'web_research');
    const controller = new AbortController();
    const signal = controller.signal;
    const onUpdate = vi.fn();
    const result = await tool.execute(
      'research-1',
      {
        query: 'A complete question',
        effort: 'low',
        history: 'private-history',
        instructions: 'private-instructions',
      },
      signal,
      onUpdate,
      createToolContext({
        cwd: '/private-project',
        model: { id: 'fixture-parent' },
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.parallel.ai/v1/responses');
    expect(new Headers(request?.headers).get('Authorization')).toBe(
      'Bearer stored-api-key'
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      model: 'parallel',
      input: 'A complete question',
      instructions: expect.stringContaining('Research the user'),
      reasoning: { effort: 'low' },
      stream: false,
    });
    expect(request?.signal?.aborted).toBe(false);
    controller.abort();
    expect(request?.signal?.aborted).toBe(true);
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'Answer with [source](https://example.com)' },
      ],
      details: { provider: 'parallel', product: 'responses', effort: 'low' },
      structuredContent: {
        text: 'Answer with [source](https://example.com)',
        effort: 'low',
      },
    });
    expect(onUpdate).toHaveBeenCalled();
    expect(result.details.outputFile).toBeUndefined();
  });

  it.each(['line', 'byte'])(
    'web_research keeps the full answer and citations at the %s limit',
    async (limit) => {
      mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
      const fullText =
        (limit === 'line'
          ? 'finding\n'.repeat(5_000)
          : '界'.repeat(DEFAULT_MAX_BYTES)) +
        '\nSources:\n[Final source](https://example.com/end)';
      const fullReport = `Response ID: resp_long\n\n${fullText}`;
      mocks.runParallelResearch.mockResolvedValue({
        text: fullText,
        effort: 'medium',
        responseId: 'resp_long',
      });
      const extension = (await import('../index.js')).default;
      const pi = createMockPi();
      extension(pi as unknown as ExtensionAPI);
      const result = await getRegisteredTool(pi, 'web_research').execute(
        'research-long',
        {
          query: 'A complete question',
        },
        undefined,
        undefined,
        createToolContext()
      );
      const outputFile = result.details.outputFile;
      try {
        expect(
          result.content[0].text.startsWith('Response ID: resp_long\n\n')
        ).toBe(true);
        expect(result.details.responseId).toBe('resp_long');
        expect(result.content[0].text).toContain('Research output truncated');
        expect(result.content[0].text).toContain(outputFile);
        expect(result.content[0].text.length).toBeLessThan(fullText.length);
        expect(Buffer.byteLength(result.content[0].text)).toBeLessThanOrEqual(
          DEFAULT_MAX_BYTES
        );
        expect(result.content[0].text.split('\n').length).toBeLessThanOrEqual(
          DEFAULT_MAX_LINES
        );
        expect(await readFile(outputFile, 'utf8')).toBe(fullReport);
        expect((await stat(outputFile)).mode & 0o077).toBe(0);
      } finally {
        if (outputFile)
          await rm(dirname(outputFile), { recursive: true, force: true });
      }
    }
  );

  it.each([
    [404, 'Interaction context not found: resp_unauthorized'],
    [404, 'Invalid interaction id: authentication'],
    [400, 'Continuation unavailable: authentication policy restriction'],
    [429, 'Rate limit exceeded for this API key'],
    [500, 'Authentication service unavailable'],
    [undefined, 'Authentication service connection failed'],
  ])(
    'web_research preserves non-authentication errors with status %s',
    async (status, message) => {
      const { isParallelAuthenticationError } = await vi.importActual<
        typeof import('../parallel-client.js')
      >('../parallel-client.js');
      mocks.isParallelAuthenticationError.mockImplementation(
        isParallelAuthenticationError
      );
      mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
      const error = Object.assign(new Error(String(message)), { status });
      mocks.runParallelResearch.mockRejectedValue(error);
      const pi = createMockPi();
      (await import('../index.js')).default(pi as unknown as ExtensionAPI);

      await expect(
        getRegisteredTool(pi, 'web_research').execute(
          'research-error',
          { query: 'A follow-up', previous_response_id: 'resp_unauthorized' },
          undefined,
          undefined,
          createToolContext()
        )
      ).rejects.toBe(error);
      expect(mocks.runParallelResearch).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['stored', 'environment'])(
    'web_research keeps HTTP 401 guidance for %s credentials',
    async (source) => {
      const { isParallelAuthenticationError } = await vi.importActual<
        typeof import('../parallel-client.js')
      >('../parallel-client.js');
      mocks.isParallelAuthenticationError.mockImplementation(
        isParallelAuthenticationError
      );
      if (source === 'environment')
        process.env.PARALLEL_API_KEY = 'rejected-key';
      mocks.getParallelApiKey.mockResolvedValue('rejected-key');
      mocks.runParallelResearch.mockRejectedValue(
        Object.assign(new Error('Rejected'), { status: 401 })
      );
      const pi = createMockPi();
      (await import('../index.js')).default(pi as unknown as ExtensionAPI);

      await expect(
        getRegisteredTool(pi, 'web_research').execute(
          'research-auth',
          { query: 'Research question' },
          undefined,
          undefined,
          createToolContext()
        )
      ).rejects.toThrow(
        source === 'environment'
          ? 'rejected PARALLEL_API_KEY'
          : 'rejected the stored credential'
      );
      expect(mocks.runParallelResearch).toHaveBeenCalledTimes(1);
    }
  );

  it('web_research reuses the existing missing-credential guidance', async () => {
    mocks.getParallelApiKey.mockResolvedValue(undefined);
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);
    await expect(
      getRegisteredTool(pi, 'web_research').execute(
        'research-auth',
        {
          query: 'A complete question',
        },
        undefined,
        undefined,
        createToolContext()
      )
    ).rejects.toThrow('/login parallel');
    expect(mocks.runParallelResearch).not.toHaveBeenCalled();
  });

  it('annotates every web tool as read-only and open-world', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    for (const name of ['web_research', 'web_search', 'web_fetch']) {
      expect(getRegisteredTool(pi, name).annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      });
    }
  });

  it('declares an output schema so scripts receive the payload, not JSON text', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    const searchPayload = {
      results: [{ title: 'Example', url: 'https://a.test' }],
    };
    const extractPayload = {
      results: [{ url: 'https://a.test', excerpts: ['text'] }],
    };
    mocks.runParallelSearch.mockResolvedValue(searchPayload);
    mocks.runParallelExtract.mockResolvedValue(extractPayload);
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(pi, 'web_search');
    const searchResult = await searchTool.execute(
      'search-structured',
      { objective: 'Find docs', search_queries: ['docs'] },
      undefined,
      undefined,
      createToolContext()
    );
    expect(searchTool.outputSchema).toBeDefined();
    expect(searchResult.structuredContent).toEqual(searchPayload);
    // The model still receives text, so the two paths stay independent.
    expect(typeof searchResult.content[0].text).toBe('string');

    const fetchTool = getRegisteredTool(pi, 'web_fetch');
    const fetchResult = await fetchTool.execute(
      'fetch-structured',
      { urls: ['https://a.test'] },
      undefined,
      undefined,
      createToolContext()
    );
    expect(fetchTool.outputSchema).toBeDefined();
    expect(fetchResult.structuredContent).toEqual(extractPayload);

    mocks.runParallelResearch.mockResolvedValue({
      text: 'An answer',
      effort: 'medium',
      responseId: 'resp_next',
    });
    const researchResult = await getRegisteredTool(pi, 'web_research').execute(
      'research-structured',
      { query: 'A question' },
      undefined,
      undefined,
      createToolContext()
    );
    expect(researchResult.structuredContent).toEqual({
      text: 'An answer',
      effort: 'medium',
      responseId: 'resp_next',
    });
  });

  it('enforces the documented argument limits in the schema', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    expect(
      getRegisteredTool(pi, 'web_search').parameters.properties.search_queries
    ).toMatchObject({ minItems: 1 });
    expect(
      getRegisteredTool(pi, 'web_fetch').parameters.properties.urls
    ).toMatchObject({ minItems: 1, maxItems: 20 });
  });

  it.each([null, 0, false, {}, [], '', ' '])(
    'web_search rejects raw invalid arguments before Pi coercion: %j',
    async (value) => {
      const extension = (await import('../index.js')).default;
      const pi = createMockPi();
      extension(pi as unknown as ExtensionAPI);
      const tool = getRegisteredTool(pi, 'web_search');

      expect(() =>
        tool.prepareArguments({ objective: value, search_queries: ['q'] })
      ).toThrow('non-empty objective');
      expect(() =>
        tool.prepareArguments({ objective: 'goal', search_queries: value })
      ).toThrow('non-empty list of search queries');
      expect(mocks.runParallelSearch).not.toHaveBeenCalled();
    }
  );

  it.each([
    [[], 'non-empty list of HTTP/HTTPS URLs'],
    [Array.from({ length: 21 }, (_, i) => `https://a.test/${i}`), 'at most 20'],
    [['example.com'], 'not an absolute URL'],
    [['ftp://a.test/file'], 'only HTTP and HTTPS'],
    [[null], 'HTTP/HTTPS URLs'],
  ])('web_fetch rejects raw invalid urls: %j', async (urls, message) => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);
    const tool = getRegisteredTool(pi, 'web_fetch');

    expect(() => tool.prepareArguments({ urls })).toThrow(message);
    expect(mocks.runParallelExtract).not.toHaveBeenCalled();
  });

  it('web_search and web_fetch drop fields the tools do not send', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    expect(
      getRegisteredTool(pi, 'web_search').prepareArguments({
        objective: 'Goal',
        search_queries: ['q'],
        history: 'private',
      })
    ).toEqual({ objective: 'Goal', search_queries: ['q'] });
    expect(
      getRegisteredTool(pi, 'web_fetch').prepareArguments({
        urls: ['https://a.test'],
        instructions: 'private',
      })
    ).toEqual({ urls: ['https://a.test'] });
  });

  it.each(['web_search', 'web_fetch'])(
    '%s keeps the complete payload on disk when the preview is cut',
    async (name) => {
      mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
      const payload = {
        results: Array.from({ length: 5000 }, (_, index) => `result-${index}`),
      };
      mocks.runParallelSearch.mockResolvedValue(payload);
      mocks.runParallelExtract.mockResolvedValue(payload);
      const extension = (await import('../index.js')).default;
      const pi = createMockPi();
      extension(pi as unknown as ExtensionAPI);
      const tool = getRegisteredTool(pi, name);

      const result = await tool.execute(
        'truncated-payload',
        name === 'web_fetch'
          ? { urls: ['https://a.test'] }
          : { objective: 'Find many results', search_queries: ['many'] },
        undefined,
        undefined,
        createToolContext()
      );

      const outputFile = result.details.outputFile;
      try {
        expect(result.details.truncated).toBe(true);
        expect(result.details.totalLines).toBeGreaterThan(DEFAULT_MAX_LINES);
        expect(result.content[0].text).toContain(
          `at the ${DEFAULT_MAX_LINES}-line limit (`
        );
        expect(result.content[0].text).toContain(`Full JSON: ${outputFile}`);
        expect(result.content[0].text).toContain('[Output truncated at the');
        expect(Buffer.byteLength(result.content[0].text)).toBeLessThanOrEqual(
          DEFAULT_MAX_BYTES
        );
        expect(result.content[0].text.split('\n').length).toBeLessThanOrEqual(
          DEFAULT_MAX_LINES
        );
        // Scripts get the whole payload even when the model only sees a head.
        expect(result.structuredContent).toEqual(payload);
        expect(await readFile(outputFile, 'utf8')).toBe(
          JSON.stringify(payload, null, 2)
        );
        expect((await stat(outputFile)).mode & 0o077).toBe(0);
      } finally {
        if (outputFile)
          await rm(dirname(outputFile), { recursive: true, force: true });
      }
    }
  );

  it('keeps search and fetch direct while research is deferred', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    // Deferred: callable from a script and reachable by name, never declared.
    expect(getRegisteredTool(pi, 'web_research').exposure).toBe('deferred');
    // Absent exposure means "direct", which declares the tool while active.
    expect(getRegisteredTool(pi, 'web_search').exposure).toBeUndefined();
    expect(getRegisteredTool(pi, 'web_fetch').exposure).toBeUndefined();
  });

  it('registers a renderer pair for every web tool', async () => {
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    for (const name of ['web_research', 'web_search', 'web_fetch']) {
      expect(typeof getRegisteredTool(pi, name).renderCall).toBe('function');
      expect(typeof getRegisteredTool(pi, name).renderResult).toBe('function');
    }
  });

  it('records payload counts in details for the renderers', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelSearch.mockResolvedValue({
      results: [{ title: 'a' }, { title: 'b' }],
      warnings: [{ message: 'partial index' }],
    });
    mocks.runParallelExtract.mockResolvedValue({
      results: [{ url: 'https://a.test' }],
      errors: [{ url: 'https://b.test', error_type: 'not_found' }],
      warnings: null,
    });
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const search = await getRegisteredTool(pi, 'web_search').execute(
      'search-counts',
      { objective: 'Find docs', search_queries: ['docs'] },
      undefined,
      undefined,
      createToolContext()
    );
    expect(search.details).toMatchObject({ results: 2, warnings: 1 });

    const fetch = await getRegisteredTool(pi, 'web_fetch').execute(
      'fetch-counts',
      { urls: ['https://a.test', 'https://b.test'] },
      undefined,
      undefined,
      createToolContext()
    );
    expect(fetch.details).toMatchObject({ results: 1, errors: 1, warnings: 0 });
  });

  it('survives a payload without the optional arrays', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    mocks.runParallelExtract.mockResolvedValue({});
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const result = await getRegisteredTool(pi, 'web_fetch').execute(
      'fetch-sparse',
      { urls: ['https://a.test'] },
      undefined,
      undefined,
      createToolContext()
    );
    expect(result.details).toMatchObject({
      results: 0,
      errors: 0,
      warnings: 0,
    });
  });

  it('names the byte limit when bytes, not lines, cut the preview', async () => {
    mocks.getParallelApiKey.mockResolvedValue('stored-api-key');
    const payload = { results: ['界'.repeat(DEFAULT_MAX_BYTES)] };
    mocks.runParallelExtract.mockResolvedValue(payload);
    const extension = (await import('../index.js')).default;
    const pi = createMockPi();
    extension(pi as unknown as ExtensionAPI);

    const result = await getRegisteredTool(pi, 'web_fetch').execute(
      'truncated-bytes',
      { urls: ['https://a.test'] },
      undefined,
      undefined,
      createToolContext()
    );

    const outputFile = result.details.outputFile;
    try {
      expect(result.content[0].text).toContain(
        `at the ${formatSize(DEFAULT_MAX_BYTES)} limit (`
      );
      expect(Buffer.byteLength(result.content[0].text)).toBeLessThanOrEqual(
        DEFAULT_MAX_BYTES
      );
      expect(await readFile(outputFile, 'utf8')).toBe(
        JSON.stringify(payload, null, 2)
      );
    } finally {
      if (outputFile)
        await rm(dirname(outputFile), { recursive: true, force: true });
    }
  });
});
