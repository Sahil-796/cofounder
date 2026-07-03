/**
 * Minimal, safe markdown → HTML for assistant messages. `marked` parses,
 * `DOMPurify` sanitizes (no raw HTML injection from model output). Kept
 * synchronous and dependency-light per PLAN's "light dependency ok" note.
 */

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src ?? "", { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
      "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "th", "td", "hr", "span",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
  });
}
