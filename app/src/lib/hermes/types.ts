/**
 * Ground-truth types for the Hermes tui_gateway JSON-RPC protocol and REST API.
 *
 * Shapes verified against:
 *   - tui_gateway/server.py  (@method handlers, _ok(...) result shapes, _emit)
 *   - tui_gateway/ws.py      (event frame envelope, _STREAMING_EVENT_TYPES)
 *   - apps/shared/src/json-rpc-gateway.ts (reference client)
 *   - hermes_cli/web_server.py (/api/status, /api/sessions, ...)
 *
 * Do not "improve" these to match intuition — they mirror the server verbatim.
 */

// ── WebSocket JSON-RPC envelope ──────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: { code?: number; message?: string };
}

/**
 * Server → client push frame. The dispatcher wraps every emit as:
 *   {"jsonrpc":"2.0","method":"event","params":{"type":..,"session_id":..,"payload":..}}
 * (see server.py::_emit and ws.py). `payload` is omitted for some events
 * (e.g. message.start).
 */
export interface JsonRpcEventFrame<P = unknown> {
  jsonrpc: "2.0";
  method: "event";
  params: HermesEvent<P>;
}

export interface HermesEvent<P = unknown> {
  type: HermesEventType;
  session_id?: string;
  payload?: P;
}

// Event type names — from apps/shared json-rpc-gateway.ts + server.py _emit calls.
export type HermesEventType =
  | "gateway.ready"
  | "session.info"
  | "message.start"
  | "message.delta"
  | "message.complete"
  | "thinking.delta"
  | "reasoning.delta"
  | "reasoning.available"
  | "status.update"
  | "tool.start"
  | "tool.progress"
  | "tool.complete"
  | "tool.generating"
  | "clarify.request"
  | "approval.request"
  | "sudo.request"
  | "secret.request"
  | "terminal.read.request"
  | "background.complete"
  | "notification"
  | "notification.clear"
  | "subagent.start"
  | "subagent.text"
  | "subagent.tool"
  | "subagent.thinking"
  | "subagent.complete"
  | "skin.changed"
  | "error"
  // Forward-compatible: unknown server event names still type-check.
  | (string & {});

// ── Event payloads (verified against server.py _emit call sites) ─────────────

export interface MessageDeltaPayload {
  text: string;
  rendered?: string;
}

/**
 * thinking.delta / reasoning.delta — server.py L3568,3614 both emit `{"text": ...}`.
 * thinking.delta = interleaved thinking; reasoning.delta = reasoning-model trace.
 * Both are pure incremental text chunks.
 */
export interface ThinkingDeltaPayload {
  text: string;
}

/** reasoning.available — server.py L3428 emits a `{preview}` (short reasoning summary). */
export interface ReasoningAvailablePayload {
  preview?: string;
  [k: string]: unknown;
}

/** tool.generating — server.py L3613 emits `{"name": ...}` when a tool call is being assembled. */
export interface ToolGeneratingPayload {
  name?: string;
}

/** message.complete — server.py ~L8707. */
export interface MessageCompletePayload {
  text: string;
  usage?: UsageInfo;
  status?: "complete" | "interrupted" | "error";
  reasoning?: string;
  rendered?: string;
  warning?: string;
}

export interface StatusUpdatePayload {
  kind: string;
  text: string;
}

/**
 * tool.start — server.py L3348 `_on_tool_start`. VERIFIED shape:
 *   { tool_id, name, context, args_text? }
 * `context` is a human label ("path/to/file", search query, etc.) built by
 * agent.display.build_tool_label. There is NO `id`/`title` field — the earlier
 * `p.id`/`p.title` reads were wrong and broke chip id/label + complete-matching.
 */
export interface ToolStartPayload {
  tool_id: string;
  name?: string;
  context?: string;
  args_text?: string;
}

/**
 * tool.complete — server.py L3363 `_on_tool_complete`. VERIFIED shape:
 *   { tool_id, name, args, duration_s?, result, summary?, result_text?, todos?, inline_diff? }
 * Matches back to tool.start by `tool_id`.
 */
export interface ToolCompletePayload {
  tool_id: string;
  name?: string;
  args?: unknown;
  duration_s?: number;
  result?: unknown;
  summary?: string;
  [k: string]: unknown;
}

/** @deprecated legacy union kept for callers that don't care about direction. */
export interface ToolEventPayload {
  tool_id?: string;
  name?: string;
  context?: string;
  status?: string;
  [k: string]: unknown;
}

/** clarify.request — server.py L3641 (_block payload). request_id is injected by _block. */
export interface ClarifyRequestPayload {
  request_id?: string;
  question: string;
  choices?: string[];
}

/** approval.request — server.py _emit_approval_request. */
export interface ApprovalRequestPayload {
  request_id?: string;
  command?: string;
  [k: string]: unknown;
}

export interface ErrorEventPayload {
  message: string;
}

export interface UsageInfo {
  total?: number;
  input?: number;
  output?: number;
  [k: string]: unknown;
}

// ── RPC result shapes ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  [k: string]: unknown;
}

/** session.create result — server.py L4996. */
export interface SessionCreateResult {
  session_id: string;
  stored_session_id: string;
  message_count: number;
  messages: ChatMessage[];
  info: {
    model?: string;
    provider?: string;
    tools?: Record<string, unknown>;
    skills?: Record<string, unknown>;
    cwd?: string;
    branch?: string;
    lazy?: boolean;
    profile_name?: string;
    [k: string]: unknown;
  };
}

/** session.resume result — server.py L5610. */
export interface SessionResumeResult {
  session_id: string;
  resumed: string;
  message_count: number;
  messages: ChatMessage[];
  info: Record<string, unknown>;
  inflight: unknown | null;
  running: boolean;
  session_key: string;
  started_at: number;
  status: string;
}

/** session.list result — server.py L5056. */
export interface SessionListItem {
  id: string;
  title: string;
  preview: string;
  started_at: number;
  message_count: number;
  source: string;
}
export interface SessionListResult {
  sessions: SessionListItem[];
}

/** session.history result — server.py L7542. */
export interface SessionHistoryResult {
  count: number;
  messages: ChatMessage[];
}

/** session.status result — server.py L7525 (human-readable text blob). */
export interface SessionStatusResult {
  output: string;
}

/** prompt.submit result — server.py L8207. */
export interface PromptSubmitResult {
  status: "streaming";
}

/** session.interrupt result — server.py L7854. */
export interface SessionInterruptResult {
  status: "interrupted";
}

/** session.close result — server.py L7739. */
export interface SessionCloseResult {
  closed: boolean;
}

/** approval.respond result — server.py L9756. */
export interface ApprovalRespondResult {
  resolved: unknown;
}

/** clarify.respond result — server.py L9724 (_respond). */
export interface RespondResult {
  status: "ok";
}

/** agents.list result — server.py L13471. */
export interface AgentProcess {
  session_id: string;
  command: string;
  status: string;
  uptime: number;
}
export interface AgentsListResult {
  processes: AgentProcess[];
}

/** spawn_tree.list result — server.py L8055. */
export interface SpawnTreeEntry {
  path: string;
  session_id: string;
  finished_at: number;
  started_at?: number;
  label: string;
  count: number;
}
export interface SpawnTreeListResult {
  entries: SpawnTreeEntry[];
}

/**
 * model.options result — server.py L12247 / REST /api/model/options.
 * VERIFIED live shape: `{ providers, model, provider }`. `model`/`provider` are
 * the CURRENT selection. Each provider row carries a plain-string `models` list
 * (model IDs), `authenticated` (creds present), `is_current`, `name`, `slug`.
 */
export interface ModelProviderRow {
  slug: string;
  name: string;
  models: string[];
  authenticated?: boolean;
  is_current?: boolean;
  total_models?: number;
  [k: string]: unknown;
}
export interface ModelOptionsResult {
  providers: ModelProviderRow[];
  /** Currently-active model id. */
  model?: string;
  /** Currently-active provider slug. */
  provider?: string;
}

/** delegation.status result — server.py L7872. */
export interface DelegationStatusResult {
  active: unknown[];
  paused: boolean;
  max_spawn_depth: number;
  max_concurrent_children: number;
}

// ── REST shapes ──────────────────────────────────────────────────────────────

/** GET /api/status — large object; we only rely on liveness (a 200 = reachable). */
export interface StatusResult {
  gateway_running?: boolean;
  [k: string]: unknown;
}
