import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from '@earendil-works/pi-coding-agent';

/** What a tool result records about a preview cut to Pi's context limits. */
export interface TruncationDetails {
  /** Present only when the output was truncated. */
  truncated?: true;
  /** Lines in the complete output. Present only when truncated. */
  totalLines?: number;
  /** Bytes in the complete output. Present only when truncated. */
  totalBytes?: number;
  /** File holding the complete output. Present only when truncated. */
  outputFile?: string;
}

export interface TruncatedOutput extends TruncationDetails {
  /** What the model sees: the head of the output, or all of it. */
  text: string;
}

/**
 * How the preview was cut, worded for the notice line, for example
 * `at the 2000-line limit: showing 1998 of 5002 lines (45.1KB of 112.5KB)`.
 */
export type TruncationSummary = string;

export interface TruncateOutputOptions {
  /** Temp directory prefix, for example `parallel-search-`. */
  directoryPrefix: string;
  /** File name inside that directory, for example `search.json`. */
  fileName: string;
  /**
   * Notice appended after the preview. Receives the path of the file holding the
   * complete output, so the model can read the rest.
   */
  notice: (path: string, summary: TruncationSummary) => string;
}

/** Separator between the truncated head and the notice line. */
const NOTICE_SEPARATOR = '\n\n';

/** Lines a trailing block occupies, counted the way Pi's truncation counts them. */
function countLines(text: string) {
  return text.split('\n').length - 1;
}

/**
 * Which Pi limit stopped the preview, and how big the complete output is.
 * `truncateHead` reports the bound it kept within, so the notice names the limit
 * that actually applied. The counts describe the complete output only, so the
 * notice never has to describe its own effect on the preview.
 */
function summarize(result: {
  truncatedBy: 'lines' | 'bytes' | null;
  maxLines: number;
  maxBytes: number;
  totalLines: number;
  totalBytes: number;
}): TruncationSummary {
  const limit =
    result.truncatedBy === 'lines'
      ? `${result.maxLines}-line`
      : formatSize(result.maxBytes);
  return `at the ${limit} limit (${result.totalLines} lines, ${formatSize(result.totalBytes)} total)`;
}

/**
 * Head of `text` when it fits within Pi's context limits, or a preview plus the
 * complete text in a private temp file.
 *
 * The notice is budgeted inside the line and byte limits rather than appended on
 * top of them, so the result never exceeds what Pi sends to the model.
 */
export async function truncateOutput(
  text: string,
  options: TruncateOutputOptions
): Promise<TruncatedOutput> {
  const measured = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!measured.truncated) {
    return { text };
  }

  const directory = await mkdtemp(join(tmpdir(), options.directoryPrefix));
  const outputFile = join(directory, options.fileName);
  // 0600: fetched web content stays readable only by the user running Pi.
  await writeFile(outputFile, text, { mode: 0o600 });

  const appended = `${NOTICE_SEPARATOR}${options.notice(
    outputFile,
    summarize(measured)
  )}`;
  const preview = truncateHead(text, {
    maxLines: Math.max(1, DEFAULT_MAX_LINES - countLines(appended)),
    maxBytes: Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(appended)),
  });

  return {
    text: `${preview.content}${appended}`,
    truncated: true,
    totalLines: measured.totalLines,
    totalBytes: measured.totalBytes,
    outputFile,
  };
}
