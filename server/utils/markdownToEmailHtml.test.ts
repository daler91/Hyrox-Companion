import { describe, expect, it } from "vitest";

import { markdownToEmailHtml } from "./markdownToEmailHtml";

describe("markdownToEmailHtml", () => {
  it("renders the coach's four-section shape as a numbered list with bold titles", () => {
    const markdown = [
      "1. **Goal Progress** — Six weeks out, 82% completion.",
      "2. **What's Working** — RPE trending down on threshold runs.",
      "3. **Watch Outs** — Sled push untouched for 24 days.",
      "4. **Recommended Focus (Next 1–2 Weeks)** — Two sled sessions.",
    ].join("\n");

    expect(markdownToEmailHtml(markdown)).toBe(
      [
        "<ol>",
        "<li><strong>Goal Progress</strong> — Six weeks out, 82% completion.</li>",
        "<li><strong>What&#39;s Working</strong> — RPE trending down on threshold runs.</li>",
        "<li><strong>Watch Outs</strong> — Sled push untouched for 24 days.</li>",
        "<li><strong>Recommended Focus (Next 1–2 Weeks)</strong> — Two sled sessions.</li>",
        "</ol>",
      ].join("\n"),
    );
  });

  it("groups consecutive bullets into one list and headings into their own tags", () => {
    const html = markdownToEmailHtml("## Watch Outs\n- Fatigue flag\n* Station gap\n\nKeep the long run easy.");

    expect(html).toBe(
      "<h3>Watch Outs</h3>\n<ul>\n<li>Fatigue flag</li>\n<li>Station gap</li>\n</ul>\n<p>Keep the long run easy.</p>",
    );
  });

  it("joins wrapped lines into one paragraph and splits on blank lines", () => {
    expect(markdownToEmailHtml("first line\nsecond line\n\nnext paragraph")).toBe(
      "<p>first line second line</p>\n<p>next paragraph</p>",
    );
  });

  it("escapes markup before converting, so model output cannot inject tags", () => {
    const html = markdownToEmailHtml('<script>alert("x")</script> **bold**');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; <strong>bold</strong>");
  });

  it("leaves an unmatched ** and other syntax as literal text", () => {
    expect(markdownToEmailHtml("**not closed and `code`")).toBe("<p>**not closed and `code`</p>");
  });

  it("needs whitespace after a block marker, and content after the whitespace", () => {
    // The `\s+(\S.*)` split is what keeps these patterns backtracking-free, so
    // pin both halves of it: no space after the marker is not a block, and a
    // bare marker with nothing to say stays the literal text the coach typed.
    expect(markdownToEmailHtml("#Heading")).toBe("<p>#Heading</p>");
    expect(markdownToEmailHtml("-bullet")).toBe("<p>-bullet</p>");
    expect(markdownToEmailHtml("1.numbered")).toBe("<p>1.numbered</p>");
    expect(markdownToEmailHtml("#   ")).toBe("<p>#</p>");
    expect(markdownToEmailHtml("-")).toBe("<p>-</p>");
  });

  it("takes the content after a run of spaces, not the spaces", () => {
    expect(markdownToEmailHtml("##  Spaced heading")).toBe("<h3>Spaced heading</h3>");
    expect(markdownToEmailHtml("-    Real bullet")).toBe("<ul>\n<li>Real bullet</li>\n</ul>");
    expect(markdownToEmailHtml("1)   Numbered")).toBe("<ol>\n<li>Numbered</li>\n</ol>");
  });

  it("returns nothing for empty input", () => {
    expect(markdownToEmailHtml("")).toBe("");
    expect(markdownToEmailHtml("\n\n")).toBe("");
  });

  it("handles Windows line endings", () => {
    expect(markdownToEmailHtml("- a\r\n- b")).toBe("<ul>\n<li>a</li>\n<li>b</li>\n</ul>");
  });
});
