/**
 * Task-tag helpers for the composer. Typing "#" opens a picker of kanban tasks;
 * selecting one inserts a `#[Task title]` token into the input. Two transforms:
 *
 *   • renderUserText(raw)  — what the USER BUBBLE shows: the pretty tokens as-is
 *     (`#[Fix onboarding]`). We keep them literal — no id leakage in the UI.
 *   • expandForModel(raw, tasks) — what the MODEL receives: each `#[Title]` token
 *     is replaced with a bracketed context line carrying title + status + id, so
 *     the agent can resolve the referenced task unambiguously.
 *
 * A token is `#[` … `]` with no nested `]`. Matching is by exact (trimmed,
 * case-insensitive) title against the current kanban board.
 */

import type { KanbanTask } from "@/lib/cofounder/extraRest";

/** Matches a `#[Task title]` token. */
const TOKEN_RE = /#\[([^\]]+)\]/g;

/** Insert a `#[title]` token at `caret`, replacing the trailing `#…` trigger. */
export function insertTaskToken(
  raw: string,
  caret: number,
  title: string,
): { text: string; caret: number } {
  // Find the "#" that opened the picker: the last "#" at/adjacent to the caret
  // with only non-space token chars after it up to the caret.
  const before = raw.slice(0, caret);
  const hash = before.lastIndexOf("#");
  const head = hash >= 0 ? raw.slice(0, hash) : before;
  const tail = raw.slice(caret);
  const token = `#[${title}] `;
  const next = head + token + tail;
  return { text: next, caret: (head + token).length };
}

/** The active "#query" the user is typing (for filtering), or null if none. */
export function activeTaskQuery(raw: string, caret: number): string | null {
  // A negative caret is the picker's "dismissed" sentinel — no active trigger.
  if (caret < 0) return null;
  const before = raw.slice(0, caret);
  const hash = before.lastIndexOf("#");
  if (hash < 0) return null;
  const frag = before.slice(hash + 1);
  // Once the token is completed (`[...]`) or a space is typed, the trigger ends.
  if (frag.startsWith("[") || /\s/.test(frag)) return null;
  return frag;
}

/**
 * Expand `#[Title]` tokens into model-facing context lines. Unmatched titles are
 * left as plain text (the model still sees the name). Matched tokens become
 * `[task: "Title" · status: <status> · id: <id>]`.
 */
export function expandForModel(raw: string, tasks: KanbanTask[]): string {
  const byTitle = new Map(tasks.map((t) => [t.title.trim().toLowerCase(), t]));
  return raw.replace(TOKEN_RE, (_m, title: string) => {
    const t = byTitle.get(title.trim().toLowerCase());
    if (!t) return title;
    return `[task: "${t.title}" · status: ${t.status} · id: ${t.id}]`;
  });
}

/** True if the raw text contains at least one task token. */
export function hasTaskToken(raw: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(raw);
}
