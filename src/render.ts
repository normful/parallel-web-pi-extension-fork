import { formatSize, type Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';

/**
 * Renderers for the interactive transcript and HTML exports. Nothing here runs
 * in JSON or print mode, and Pi falls back to its own layout when a renderer
 * throws, so these only affect what a person watching the session sees.
 */

/** Longest argument echo in a call line, in characters. */
const ARG_WIDTH = 60;
/** Longest single-line summary before it is clipped. */
const SUMMARY_WIDTH = 120;

const SEPARATOR = ' · ';

interface TextBlock {
  type: string;
  text?: string;
}

interface RenderedResult {
  content: readonly TextBlock[];
  details?: unknown;
}

interface RenderOptions {
  expanded: boolean;
  isPartial: boolean;
}

interface RenderContext {
  durationMs?: number;
}

/** Every field a web tool result may record. Details arrive untyped and partial. */
interface DetailFields {
  truncated?: boolean;
  outputFile?: string;
  totalBytes?: number;
  effort?: string;
  results?: number;
  errors?: number;
  warnings?: number;
  urls?: readonly string[];
}

export interface ResearchArgs {
  query?: string;
  effort?: string;
  previous_response_id?: string;
}

export interface SearchArgs {
  objective?: string;
  search_queries?: readonly string[];
}

export interface FetchArgs {
  urls?: readonly string[];
}

function detailsOf(result: RenderedResult): DetailFields {
  return (result.details ?? {}) as DetailFields;
}

/** Layout shared by every web tool: one summary line, then the text when expanded. */
function summaryLine(
  theme: Theme,
  parts: readonly (string | undefined | false)[]
) {
  const shown = parts.filter((part): part is string => !!part);
  return shown.join(theme.fg('muted', SEPARATOR));
}

function clip(value: string, width = ARG_WIDTH) {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 3)}...`;
}

/** The text Pi sends to the model, which the renderer shows when expanded. */
function textOf(result: RenderedResult) {
  return result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

/**
 * Size of the complete output. A truncated result records it; otherwise the
 * text Pi holds is the complete output.
 */
function sizeLabel(result: RenderedResult, text: string) {
  const bytes = detailsOf(result).totalBytes ?? Buffer.byteLength(text);
  return bytes > 0 ? formatSize(bytes) : undefined;
}

function durationLabel(context: RenderContext | undefined) {
  const ms = context?.durationMs;
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Flags a preview that stopped short of the complete output. */
function truncatedLabel(theme: Theme, result: RenderedResult) {
  return detailsOf(result).truncated
    ? theme.fg('warning', 'truncated')
    : undefined;
}

/** A pending line replaces the metrics a finished result reports. */
function pendingLabel(theme: Theme, verb: string) {
  return theme.fg('muted', verb);
}

function frame(
  theme: Theme,
  result: RenderedResult,
  line: string,
  text: string,
  expanded: boolean
) {
  if (!expanded) return new Text(line, 0, 0);
  const lines = [line, '', theme.fg('toolOutput', text)];
  const outputFile = detailsOf(result).outputFile;
  if (outputFile)
    lines.push('', theme.fg('muted', `Full output: ${outputFile}`));
  return new Text(lines.join('\n'), 0, 0);
}

// ============================================================================
// web_research
// ============================================================================

export function renderResearchCall(args: ResearchArgs, theme: Theme) {
  const continuation = args.previous_response_id
    ? `after ${clip(args.previous_response_id, 24)}`
    : undefined;
  const meta = [args.effort ?? 'medium', continuation]
    .filter(Boolean)
    .join(SEPARATOR);
  const query = args.query ? clip(args.query) : theme.fg('muted', '...');
  return new Text(
    `${theme.fg('toolTitle', theme.bold('web_research'))}  ${query}  ${theme.fg('muted', meta)}`,
    0,
    0
  );
}

export function renderResearchResult(
  result: RenderedResult,
  { expanded, isPartial }: RenderOptions,
  theme: Theme,
  context?: RenderContext
) {
  const details = detailsOf(result);
  const text = textOf(result);
  const line = isPartial
    ? summaryLine(theme, [details.effort, pendingLabel(theme, 'researching')])
    : summaryLine(theme, [
        details.effort,
        durationLabel(context),
        sizeLabel(result, text),
        truncatedLabel(theme, result),
      ]);
  return frame(theme, result, clip(line, SUMMARY_WIDTH), text, expanded);
}

// ============================================================================
// web_search
// ============================================================================

export function renderSearchCall(args: SearchArgs, theme: Theme) {
  const queries = args.search_queries?.length ?? 0;
  const objective = args.objective
    ? clip(args.objective)
    : theme.fg('muted', '...');
  const label = queries === 1 ? '1 query' : `${queries} queries`;
  return new Text(
    `${theme.fg('toolTitle', theme.bold('web_search'))}  ${objective}  ${theme.fg('muted', label)}`,
    0,
    0
  );
}

export function renderSearchResult(
  result: RenderedResult,
  { expanded, isPartial }: RenderOptions,
  theme: Theme,
  _context?: RenderContext
) {
  const details = detailsOf(result);
  const text = textOf(result);
  const found =
    details.results === undefined
      ? undefined
      : details.results === 1
        ? '1 result'
        : `${details.results} results`;
  const line = isPartial
    ? summaryLine(theme, [pendingLabel(theme, 'searching')])
    : summaryLine(theme, [
        found,
        details.warnings
          ? theme.fg('warning', `${details.warnings} warnings`)
          : undefined,
        sizeLabel(result, text),
        truncatedLabel(theme, result),
      ]);
  return frame(theme, result, clip(line, SUMMARY_WIDTH), text, expanded);
}

// ============================================================================
// web_fetch
// ============================================================================

/** Host of a URL for a one-line call summary, or the raw value when unparsable. */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return clip(url, 40);
  }
}

export function renderFetchCall(args: FetchArgs, theme: Theme) {
  const urls = args.urls ?? [];
  const first = urls[0];
  const target =
    first === undefined
      ? '...'
      : urls.length === 1
        ? hostOf(first)
        : `${urls.length} URLs`;
  const host = first === undefined || urls.length === 1 ? '' : hostOf(first);
  const meta = host ? theme.fg('muted', SEPARATOR + host) : '';
  return new Text(
    `${theme.fg('toolTitle', theme.bold('web_fetch'))}  ${clip(target)}${meta}`,
    0,
    0
  );
}

export function renderFetchResult(
  result: RenderedResult,
  { expanded, isPartial }: RenderOptions,
  theme: Theme,
  _context?: RenderContext
) {
  const details = detailsOf(result);
  const text = textOf(result);
  const requested = details.urls?.length;
  const fetched = details.results;
  const count =
    fetched === undefined
      ? undefined
      : requested
        ? `${fetched} of ${requested} URLs`
        : `${fetched} URLs`;
  const line = isPartial
    ? summaryLine(theme, [pendingLabel(theme, 'fetching')])
    : summaryLine(theme, [
        count,
        details.errors
          ? theme.fg('error', `${details.errors} failed`)
          : undefined,
        details.warnings
          ? theme.fg('warning', `${details.warnings} warnings`)
          : undefined,
        sizeLabel(result, text),
        truncatedLabel(theme, result),
      ]);
  return frame(theme, result, clip(line, SUMMARY_WIDTH), text, expanded);
}
