import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/**
 * An Overview chart's AI reading rendered as Markdown. This is its own module
 * so ChartExplanation can load it lazily: react-markdown and rehype-sanitize
 * (~122 kB raw / ~37 kB gzip) then download only once an explanation is shown,
 * not on every /analytics visit.
 */
export default function ChartExplanationMarkdown({ content }: { readonly content: string }) {
  // AI output rendered as Markdown; rehype-sanitize strips script tags, event
  // handlers and javascript:/data: URLs so a compromised provider or a
  // prompt-injection attempt can't run JS in the user's session.
  return <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>;
}
