import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * GFM gives the coach tables (pacing splits, a week's sessions), strikethrough
 * and task lists, which plain CommonMark printed as pipes and tildes. A table
 * wider than the bubble scrolls instead of squashing its columns on a phone.
 */
const MARKDOWN_PLUGINS = [remarkGfm];
const SANITIZE_PLUGINS = [rehypeSanitize];
const MARKDOWN_COMPONENTS: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

/**
 * A coach reply rendered as markdown. Its own module so ChatMessage can load it
 * lazily: react-markdown, remark-gfm and rehype-sanitize then stay out of the
 * Timeline chunk, which reaches ChatMessage through the workout sheets' coach
 * chat (PF8, CODEBASE_ANALYSIS_2026-10-03).
 *
 * AI output is untrusted: rehype-sanitize strips script tags, event handlers,
 * and javascript:/data: URLs so a compromised provider or prompt-injection
 * attempt can't run arbitrary JS in the user's session (C2).
 */
export default function ChatMarkdown({ content }: { readonly content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PLUGINS}
      rehypePlugins={SANITIZE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
}
