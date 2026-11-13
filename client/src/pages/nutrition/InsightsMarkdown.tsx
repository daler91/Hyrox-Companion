import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/**
 * Stored nutrition insights rendered as Markdown. This is its own module so
 * NutritionInsightsPanel can load it lazily: react-markdown and rehype-sanitize
 * (~122 kB raw / ~37 kB gzip) then download only once there are insights to
 * show, not on every /nutrition visit.
 */
export default function InsightsMarkdown({ content }: { readonly content: string }) {
  // AI output rendered as Markdown; rehype-sanitize strips scripts and unsafe
  // URLs so a compromised provider can't run JS in the session.
  return <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>;
}
