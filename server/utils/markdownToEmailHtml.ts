import { sanitizeHtml } from "./sanitize";

/**
 * Render the small Markdown subset the coach writes into email-safe HTML.
 *
 * The input is model output, so everything is entity-escaped FIRST and the
 * conversion only ever emits tags of its own: `#`/`##`/`###` headings,
 * `**bold**`, `-`/`*` bullets, `1.` numbered items, and blank-line separated
 * paragraphs. Links, code, tables and raw HTML stay as literal text. No
 * markdown library is installed server-side and this covers the four-section
 * shape `coachInsightsService` asks for.
 */
export function markdownToEmailHtml(markdown: string): string {
  const lines = sanitizeHtml(markdown).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    out.push(`</${list}>`);
    list = null;
  };
  const openList = (kind: "ul" | "ol") => {
    if (list === kind) return;
    closeList();
    list = kind;
    out.push(`<${kind}>`);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1; // "#" is the email's h2; h1 is the header
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      openList("ul");
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      flushParagraph();
      openList("ol");
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return out.join("\n");
}

/** `**bold**` only; an unmatched `**` is left as typed. */
function inline(text: string): string {
  return text.replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
