import { describe, expect, it } from 'vitest';
import type { Theme } from '@earendil-works/pi-coding-agent';
import {
  renderFetchCall,
  renderFetchResult,
  renderResearchCall,
  renderResearchResult,
  renderSearchCall,
  renderSearchResult,
} from '../render.js';

/** Colors are stripped so a test reads the text a person would see. */
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const collapsed = { expanded: false, isPartial: false };
const expanded = { expanded: true, isPartial: false };
const partial = { expanded: false, isPartial: true };

function lines(component: { render(width: number): string[] }) {
  return component.render(200).join('\n');
}

describe('web_research renderer', () => {
  it('shows the question and effort on the call line', () => {
    const rendered = lines(
      renderResearchCall(
        { query: 'Compare Node and Bun', effort: 'high' },
        theme
      )
    );
    expect(rendered).toContain('web_research');
    expect(rendered).toContain('Compare Node and Bun');
    expect(rendered).toContain('high');
  });

  it('defaults the effort and names the continuation', () => {
    const rendered = lines(
      renderResearchCall(
        { query: 'Follow-up', previous_response_id: 'resp_abc' },
        theme
      )
    );
    expect(rendered).toContain('medium');
    expect(rendered).toContain('after resp_abc');
  });

  it('summarizes size and duration when collapsed', () => {
    const rendered = lines(
      renderResearchResult(
        {
          content: [{ type: 'text', text: 'x'.repeat(2048) }],
          details: { effort: 'medium' },
        },
        collapsed,
        theme,
        { durationMs: 38200 }
      )
    );
    expect(rendered).toContain('medium');
    expect(rendered).toContain('38.2s');
    expect(rendered).toContain('2.0KB');
    // Collapsed output is a single line, so the whole answer stays hidden.
    expect(rendered).not.toContain('x'.repeat(64));
  });

  it('shows the answer and the full-output path when expanded', () => {
    const rendered = lines(
      renderResearchResult(
        {
          content: [{ type: 'text', text: 'The answer.' }],
          details: {
            effort: 'low',
            truncated: true,
            outputFile: '/tmp/parallel-research-x/research.md',
            totalBytes: 4096,
          },
        },
        expanded,
        theme,
        { durationMs: 900 }
      )
    );
    expect(rendered).toContain('The answer.');
    expect(rendered).toContain('truncated');
    expect(rendered).toContain('4.0KB');
    expect(rendered).toContain('/tmp/parallel-research-x/research.md');
  });

  it('reports pending work without inventing metrics', () => {
    const rendered = lines(
      renderResearchResult(
        {
          content: [{ type: 'text', text: 'Researching the web...' }],
          details: { provider: 'parallel', product: 'responses' },
        },
        partial,
        theme
      )
    );
    expect(rendered).toContain('researching');
    expect(rendered).not.toContain('Researching the web');
    expect(rendered).not.toContain('B');
  });

  it('survives a result with no details', () => {
    const rendered = lines(
      renderResearchResult({ content: [] }, collapsed, theme)
    );
    expect(rendered).not.toContain('undefined');
  });
});

describe('web_search renderer', () => {
  it('counts the queries on the call line', () => {
    const rendered = lines(
      renderSearchCall(
        { objective: 'Find docs', search_queries: ['a', 'b'] },
        theme
      )
    );
    expect(rendered).toContain('web_search');
    expect(rendered).toContain('Find docs');
    expect(rendered).toContain('2 queries');
  });

  it('survives a call line with no arguments yet', () => {
    expect(lines(renderSearchCall({}, theme))).toContain('web_search');
  });

  it('summarizes results and warnings when collapsed', () => {
    const rendered = lines(
      renderSearchResult(
        {
          content: [{ type: 'text', text: 'json' }],
          details: { results: 12, warnings: 2 },
        },
        collapsed,
        theme
      )
    );
    expect(rendered).toContain('12 results');
    expect(rendered).toContain('2 warnings');
    expect(rendered).toContain('4B');
  });

  it('shows the payload when expanded', () => {
    const rendered = lines(
      renderSearchResult(
        {
          content: [{ type: 'text', text: '{"results":[]}' }],
          details: { results: 0 },
        },
        expanded,
        theme
      )
    );
    expect(rendered).toContain('{"results":[]}');
    expect(rendered).toContain('0 results');
  });

  it('reports pending work', () => {
    expect(
      lines(renderSearchResult({ content: [] }, partial, theme))
    ).toContain('searching');
  });
});

describe('web_fetch renderer', () => {
  it('shows the host for a single URL and the count for several', () => {
    expect(
      lines(renderFetchCall({ urls: ['https://api.parallel.ai/docs'] }, theme))
    ).toContain('api.parallel.ai');
    expect(
      lines(
        renderFetchCall({ urls: ['https://a.test', 'https://b.test'] }, theme)
      )
    ).toContain('2 URLs');
  });

  it('shows an unparsable URL instead of throwing', () => {
    expect(lines(renderFetchCall({ urls: ['not a url'] }, theme))).toContain(
      'not a url'
    );
  });

  it('summarizes fetched and failed URLs', () => {
    const rendered = lines(
      renderFetchResult(
        {
          content: [{ type: 'text', text: 'json' }],
          details: { urls: ['a', 'b'], results: 1, errors: 1 },
        },
        collapsed,
        theme
      )
    );
    expect(rendered).toContain('1 of 2 URLs');
    expect(rendered).toContain('1 failed');
  });

  it('reports pending work', () => {
    expect(lines(renderFetchResult({ content: [] }, partial, theme))).toContain(
      'fetching'
    );
  });
});
