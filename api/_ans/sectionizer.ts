/**
 * ASCII-side sectionizer for .ans files.
 *
 * After the binary header, the .ans file contains a mix of length-prefixed
 * ASCII strings and padding. We extract a printable-ASCII view of the
 * pre-data window, normalize NULs/control bytes to spaces, then walk it
 * looking for section headings (see SECTION_HEADINGS in synonyms.ts).
 *
 * Every recognized region is emitted as an AnsRawSection so the field
 * extractor can scope its regexes by section instead of running global
 * regexes that misattribute values (e.g. an HR from the standing section
 * leaking into baseline).
 */

import type { AnsRawSection, AnsSectionId } from "../../shared/ansStudy.js";
import { SECTION_HEADINGS } from "./synonyms.js";

const PRINTABLE_RE = /[\x20-\x7E\r\n\t]/;

/**
 * Build a printable-ASCII view of the bytes between `start` and `end`.
 * Non-printable bytes become a single space; this keeps offsets stable so
 * regex matches still map back to the source byte offsets.
 */
export function asciiView(buf: Buffer, start: number, end: number): string {
  const safeEnd = Math.min(end, buf.length);
  const out: string[] = [];
  for (let i = start; i < safeEnd; i++) {
    const ch = String.fromCharCode(buf[i]);
    out.push(PRINTABLE_RE.test(ch) ? ch : " ");
  }
  return out.join("");
}

interface HeadingHit {
  id: AnsSectionId;
  start: number; // absolute byte offset
  headerText: string;
  matchEnd: number; // absolute byte offset just past the matched heading
}

/**
 * Walk the ASCII view and find every section heading. Returns hits sorted
 * by start offset.
 */
export function findSectionHeadings(
  text: string,
  textStartOffset: number,
): HeadingHit[] {
  const hits: HeadingHit[] = [];
  const seen = new Set<string>(); // dedupe identical (id,start) pairs

  for (const [id, patterns] of Object.entries(SECTION_HEADINGS) as [
    AnsSectionId,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      // Use a sticky global form
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = textStartOffset + m.index;
        const key = `${id}@${start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          id,
          start,
          matchEnd: textStartOffset + m.index + m[0].length,
          headerText: m[0],
        });
      }
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/**
 * Slice the ASCII view into AnsRawSection objects using the heading hits.
 * Every chunk between two adjacent hits becomes one section; a chunk before
 * the first hit (if any) is labelled "unknown".
 */
export function sectionize(
  buf: Buffer,
  windowStart: number,
  windowEnd: number,
): AnsRawSection[] {
  const view = asciiView(buf, windowStart, windowEnd);
  const hits = findSectionHeadings(view, windowStart);
  const sections: AnsRawSection[] = [];

  if (hits.length === 0) {
    // No headings — return a single "unknown" section spanning the window.
    sections.push({
      id: "unknown",
      startOffset: windowStart,
      endOffset: windowEnd,
      text: view,
    });
    return sections;
  }

  // Leading unknown chunk (if any)
  if (hits[0].start > windowStart) {
    sections.push({
      id: "unknown",
      startOffset: windowStart,
      endOffset: hits[0].start,
      text: asciiView(buf, windowStart, hits[0].start),
    });
  }

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const nextStart = i + 1 < hits.length ? hits[i + 1].start : windowEnd;
    sections.push({
      id: hit.id,
      headerText: hit.headerText,
      startOffset: hit.start,
      endOffset: nextStart,
      text: asciiView(buf, hit.matchEnd, nextStart),
    });
  }
  return sections;
}

/** Lookup the first section with a given id. */
export function findSection(
  sections: AnsRawSection[],
  id: AnsSectionId,
): AnsRawSection | undefined {
  return sections.find((s) => s.id === id);
}
