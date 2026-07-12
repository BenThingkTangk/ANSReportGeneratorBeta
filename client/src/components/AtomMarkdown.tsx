import { type ReactNode } from "react";

/**
 * Lightweight, dependency-free Markdown renderer for Atom chat responses.
 *
 * Builds React elements directly (never dangerouslySetInnerHTML), so it is
 * inherently safe from HTML injection. Link hrefs are additionally restricted
 * to http(s)/mailto to block javascript:/data: URLs.
 *
 * Supported: headings, bold, italic, inline code, links, ordered/unordered
 * lists, blockquotes, horizontal rules and paragraphs. Unsupported syntax
 * (e.g. tables) degrades gracefully to plain text.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Order matters: inline code, then bold, then italic, then links.
const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*?\*|_[^_\s][^_]*?_)|(\[[^\]]+\]\([^)\s]+\))/;

function parseInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={k++}
          className="px-1 py-0.5 rounded text-[11px] font-mono"
          style={{ background: "hsl(210 18% 18%)", color: "hsl(185 70% 72%)" }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={k++} className="font-semibold" style={{ color: "hsl(200 20% 92%)" }}>
          {parseInline(tok.slice(2, -2))}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (lm && SAFE_URL.test(lm[2])) {
        out.push(
          <a
            key={k++}
            href={lm[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: "hsl(185 85% 60%)" }}
          >
            {lm[1]}
          </a>,
        );
      } else {
        out.push(lm ? lm[1] : tok);
      }
    } else {
      // Italic (single * or _).
      out.push(<em key={k++}>{parseInline(tok.slice(1, -1))}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^([-*_])\1{2,}\s*$/;
const QUOTE = /^>\s?/;
const OL_ITEM = /^\d+[.)]\s+/;
const UL_ITEM = /^[-*+]\s+/;

function isBlank(s: string): boolean {
  return s.trim() === "";
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const size = level <= 1 ? "text-sm" : level === 2 ? "text-[13px]" : "text-xs";
      blocks.push(
        <div key={key++} className={`${size} font-semibold pt-0.5`} style={{ color: "hsl(200 20% 92%)" }}>
          {parseInline(h[2])}
        </div>,
      );
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push(<div key={key++} className="my-1 border-t" style={{ borderColor: "hsl(210 15% 20%)" }} />);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quote.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 pl-2 italic"
          style={{ borderColor: "hsl(185 85% 42% / 0.5)", color: "hsl(210 10% 70%)" }}
        >
          {parseInline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (OL_ITEM.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(<li key={items.length}>{parseInline(lines[i].replace(OL_ITEM, ""))}</li>);
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-5 space-y-1">
          {items}
        </ol>,
      );
      continue;
    }

    if (UL_ITEM.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(<li key={items.length}>{parseInline(lines[i].replace(UL_ITEM, ""))}</li>);
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 space-y-1">
          {items}
        </ul>,
      );
      continue;
    }

    // Paragraph: gather consecutive lines until a blank line or a new block.
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !OL_ITEM.test(lines[i]) &&
      !UL_ITEM.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="leading-relaxed">
        {parseInline(para.join(" "))}
      </p>,
    );
  }

  return blocks;
}

export function AtomMarkdown({ content }: { content: string }) {
  if (!content) return null;
  return <div className="space-y-2">{parseBlocks(content)}</div>;
}
