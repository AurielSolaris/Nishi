/**
 * Find and replace over a TextBuffer.
 *
 * Matches are recomputed rather than tracked as markers: a marker layer only
 * pays for itself once decorations exist (Stage 3/5), and recomputing keeps
 * results provably in step with the buffer after every edit.
 */

import type { TextBuffer } from "./buffer.ts";

export type SearchOptions = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type Match = {
  start: number;
  end: number;
};

export const EMPTY_OPTIONS: SearchOptions = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the matching pattern. Returns null when the query is empty or the
 * user's regex does not compile — callers show "no results" rather than
 * throwing on every keystroke of a half-typed pattern.
 */
export function buildPattern(options: SearchOptions): RegExp | null {
  if (options.query === "") return null;

  let source = options.regex ? options.query : escapeRegExp(options.query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;

  const flags = options.caseSensitive ? "gu" : "giu";
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function findMatches(buffer: TextBuffer, options: SearchOptions, limit = 5000): Match[] {
  const pattern = buildPattern(options);
  if (!pattern) return [];

  const text = buffer.getText();
  const matches: Match[] = [];

  for (const m of text.matchAll(pattern)) {
    const start = m.index;
    // A zero-length match (e.g. `a*`) would spin forever without this guard;
    // matchAll advances internally, but we still refuse to record them.
    if (m[0].length === 0) continue;
    matches.push({ start, end: start + m[0].length });
    if (matches.length >= limit) break;
  }

  return matches;
}

/** Index of the first match at or after `offset`, wrapping around. */
export function nextMatchIndex(matches: Match[], offset: number): number {
  if (matches.length === 0) return -1;
  const found = matches.findIndex((m) => m.start >= offset);
  return found === -1 ? 0 : found;
}

/** Index of the last match strictly before `offset`, wrapping around. */
export function previousMatchIndex(matches: Match[], offset: number): number {
  if (matches.length === 0) return -1;
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i]!.start < offset) return i;
  }
  return matches.length - 1;
}

/**
 * Expand `$1`-style references for a regex replacement. Plain (non-regex)
 * searches replace literally, so a `$` in the replacement stays a `$`.
 */
export function expandReplacement(
  replacement: string,
  options: SearchOptions,
  buffer: TextBuffer,
  match: Match,
): string {
  if (!options.regex) return replacement;

  const pattern = buildPattern({ ...options, regex: true });
  if (!pattern) return replacement;

  const matched = buffer.getTextRange(match.start, match.end);
  // Re-run against the matched text alone to recover its capture groups.
  const groups = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(matched);
  if (!groups) return replacement;

  return replacement.replace(/\$(\d{1,2}|&)/g, (whole, ref: string) => {
    if (ref === "&") return groups[0] ?? "";
    const index = Number(ref);
    return groups[index] ?? whole;
  });
}

/** Replace every match, back to front so earlier offsets stay valid. */
export function replaceAll(
  buffer: TextBuffer,
  options: SearchOptions,
  replacement: string,
): number {
  const matches = findMatches(buffer, options);
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    buffer.replace(
      match.start,
      match.end - match.start,
      expandReplacement(replacement, options, buffer, match),
    );
  }
  if (matches.length > 0) buffer.breakUndoGroup();
  return matches.length;
}
