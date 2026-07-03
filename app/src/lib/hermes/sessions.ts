/**
 * Typed wrappers over the tui_gateway JSON-RPC methods.
 *
 * Every wrapper mirrors the exact param/result contract from
 * tui_gateway/server.py. `profile` is a top-level param on session.create /
 * session.resume (verified server.py L4914, L5277; and the dashboard's
 * ChatSidebar.tsx passes it the same way) — it targets a named Hermes profile
 * home (~/.hermes/profiles/<name>/). Omit it to use the launch profile.
 */

import type { HermesWs } from "./ws";
import type {
  AgentsListResult,
  ApprovalRespondResult,
  ChatMessage,
  DelegationStatusResult,
  ModelOptionsResult,
  PromptSubmitResult,
  RespondResult,
  SessionCloseResult,
  SessionCreateResult,
  SessionHistoryResult,
  SessionInterruptResult,
  SessionListResult,
  SessionResumeResult,
  SessionStatusResult,
  SpawnTreeListResult,
} from "./types";

export interface SessionCreateParams {
  /** Named profile home to bind the session to (e.g. "cofounder"). */
  profile?: string;
  title?: string;
  /** Session origin tag; server default "tui". */
  source?: string;
  /** Terminal width for rendered output; server default 80. */
  cols?: number;
  /** Explicit workspace dir; falls back to gateway launch dir if unset/invalid. */
  cwd?: string;
  /** Reap this session + its worker when the WS drops. */
  close_on_disconnect?: boolean;
  /** Seed history for a fresh session. */
  messages?: ChatMessage[];
  parent_session_id?: string;
  model?: string;
  provider?: string;
  reasoning_effort?: string;
  fast?: boolean;
}

export class HermesSessions {
  constructor(private readonly ws: HermesWs) {}

  create(params: SessionCreateParams = {}): Promise<SessionCreateResult> {
    return this.ws.request<SessionCreateResult>("session.create", { ...params });
  }

  resume(
    session_id: string,
    opts: { profile?: string; cols?: number; lazy?: boolean } = {},
  ): Promise<SessionResumeResult> {
    return this.ws.request<SessionResumeResult>("session.resume", {
      session_id,
      ...opts,
    });
  }

  list(limit = 200): Promise<SessionListResult> {
    return this.ws.request<SessionListResult>("session.list", { limit });
  }

  history(session_id: string): Promise<SessionHistoryResult> {
    return this.ws.request<SessionHistoryResult>("session.history", {
      session_id,
    });
  }

  status(session_id: string): Promise<SessionStatusResult> {
    return this.ws.request<SessionStatusResult>("session.status", {
      session_id,
    });
  }

  interrupt(session_id: string): Promise<SessionInterruptResult> {
    return this.ws.request<SessionInterruptResult>("session.interrupt", {
      session_id,
    });
  }

  close(session_id: string): Promise<SessionCloseResult> {
    return this.ws.request<SessionCloseResult>("session.close", { session_id });
  }

  /** Submit a prompt; reply streams via message.delta / message.complete events. */
  submitPrompt(
    session_id: string,
    text: string,
    opts: { truncate_before_user_ordinal?: number } = {},
  ): Promise<PromptSubmitResult> {
    return this.ws.request<PromptSubmitResult>("prompt.submit", {
      session_id,
      text,
      ...opts,
    });
  }

  /** Answer an approval.request. `choice` is typically "allow" | "deny". */
  respondApproval(
    session_id: string,
    choice: string,
    all = false,
  ): Promise<ApprovalRespondResult> {
    return this.ws.request<ApprovalRespondResult>("approval.respond", {
      session_id,
      choice,
      all,
    });
  }

  /** Answer a clarify.request. `request_id` comes from the event payload. */
  respondClarify(request_id: string, answer: string): Promise<RespondResult> {
    return this.ws.request<RespondResult>("clarify.respond", {
      request_id,
      answer,
    });
  }

  agentsList(): Promise<AgentsListResult> {
    return this.ws.request<AgentsListResult>("agents.list", {});
  }

  spawnTreeList(
    opts: { session_id?: string; limit?: number; cross_session?: boolean } = {},
  ): Promise<SpawnTreeListResult> {
    return this.ws.request<SpawnTreeListResult>("spawn_tree.list", { ...opts });
  }

  delegationStatus(): Promise<DelegationStatusResult> {
    return this.ws.request<DelegationStatusResult>("delegation.status", {});
  }

  /**
   * model.options — provider/model catalog with the current selection.
   * `session_id` scopes the "current" to a live session (falls back to disk
   * config). Returns `{ providers, model, provider }`.
   */
  modelOptions(opts: { session_id?: string; refresh?: boolean } = {}): Promise<ModelOptionsResult> {
    return this.ws.request<ModelOptionsResult>("model.options", { ...opts });
  }
}
