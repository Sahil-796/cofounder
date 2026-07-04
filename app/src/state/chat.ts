/**
 * Multi-agent chat store. Owns N named chats — the `cofounder` orchestrator
 * (default) plus one per role (marketing, research, support, operations,
 * finance). Each chat is its own live Hermes session, but NOT all on the same
 * profile: the orchestrator runs on the `cofounder` profile, and each role
 * runs on its OWN dedicated profile (`cofounder-<role>`, see
 * `roleProfileName` in lib/cofounder/bootstrap.ts). This is what makes
 * delegation real — a role's kanban tasks can be genuinely dispatched to that
 * profile, and its chat tab IS that profile's own session history, not a
 * client-side simulation. A role's persona lives in its profile's own SOUL
 * (installed at bootstrap), so no persona-seed history is needed on
 * session.create. Events are routed to the owning chat by session_id.
 *
 * Every chat preserves the full single-session behavior that shipped before:
 * thinking/reasoning deltas, tool chips keyed by tool_id, clarify/approval
 * flow, model override on session.create, and Esc interrupt.
 *
 * The store exposes the SAME method surface as the old single-session store
 * (send / answerClarify / respondApproval / interrupt / setModel /
 * ensureSession / clearNotice) — these all operate on the ACTIVE chat, so
 * existing callers (AppShell.onSendToChat, CofounderTab, ModelPicker) keep
 * working unchanged. `activeAgent` / `setActiveAgent` select which chat is live.
 *
 * SESSIONS-PER-AGENT. Each agent chat owns a *list* of past sessions and one
 * active session at a time. The list comes from session.list filtered to this
 * app's rows (source === APP_SOURCE) with the agent parsed from the title tag.
 * The active stored key is persisted in localStorage per agent and resumed on
 * startup/reconnect (session.resume returns a fresh live session_id + the full
 * transcript). Two identities matter and MUST NOT be confused:
 *   • sessionId  — the LIVE gateway session id (from create/resume). Events are
 *                  routed by this. It changes every resume.
 *   • sessionKey — the STORED session key (session.list `id`). Stable across
 *                  resumes; what session.list/resume(target)/delete operate on.
 *
 * CONTEXT PRESERVATION. When a session must be recreated (model change, WS
 * reconnect) we seed the new session with the prior thread via session.create's
 * `messages` param (the last ~40 turns) so switching models mid-conversation
 * keeps context.
 *
 * MODEL IS PER-AGENT. Each role is a separate profile now, so "the model" is a
 * per-slot property (ChatSlot.model/provider/modelPinned), not a single global
 * — setModel() applies to the active chat's own profile only.
 *
 * WORKSPACE. session.create is given `cwd: loadConfig().workspaceRoot` so the
 * agents' files land in the configured workspace, not the gateway launch dir.
 *
 * DIAGNOSTICS. A per-slot watchdog surfaces a notice if prompt.submit succeeds
 * but no stream event arrives within WATCHDOG_MS; see src/state/log.ts for the
 * ring-buffer trail wired via installWsLogging().
 *
 * All backend I/O goes through src/lib/hermes (sessions singleton + hermesWs).
 */

import { create } from "zustand";
import { hermesRest, hermesWs, sessions } from "@/lib/hermes";
import type {
  ApprovalRequestPayload,
  ClarifyRequestPayload,
  ErrorEventPayload,
  HermesEvent,
  MessageCompletePayload,
  MessageDeltaPayload,
  SessionListItem,
  StatusUpdatePayload,
  ThinkingDeltaPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ToolStartPayload,
} from "@/lib/hermes";
import type { ChatMessage } from "@/lib/hermes";
import { COFOUNDER_PROFILE, roleProfileName } from "@/lib/cofounder/bootstrap";
import { AGENTS, agentById } from "@/lib/cofounder/roles";
import { loadConfig } from "@/lib/cofounder/config";
import { installWsLogging, logEvent } from "@/state/log";

/** Cap on stored thinking text so a long reasoning trace can't bloat memory. */
const THINKING_CAP = 20_000;

/** How many prior turns to re-seed when recreating a session (model change etc). */
const CONTEXT_SEED_CAP = 40;

/** Watchdog: if no stream event lands this long after prompt.submit, warn. */
const WATCHDOG_MS = 20_000;

/**
 * Watchdog re-arms itself while `session.status` still reports the agent
 * running, rechecking every WATCHDOG_MS. After this many rounds with zero
 * stream activity, give up on the run instead of polling forever — a run
 * that's truly alive would have emitted SOME event (thinking/tool/delta) by
 * then. Caps a wedged run at ~2 minutes of silent "loading" instead of
 * leaving the UI stuck indefinitely (see the "prompts just show loading"
 * bug: reconcileStreaming used to fire once, see the agent still reported
 * "running", and never check again).
 */
const WATCHDOG_MAX_ROUNDS = 6;

/** session.list `source` tag that marks a session as owned by this app. */
export const APP_SOURCE = "cofounder-app";

/** localStorage key holding the per-agent active stored session key. */
const ACTIVE_SESSIONS_KEY = "cofounder.activeSessions.v1";

export interface ToolChip {
  id: string;
  label: string;
  status: "running" | "done";
}

/** Live reasoning/thinking accumulated on the streaming assistant message. */
export interface ThinkingBlock {
  text: string;
  /** epoch ms when thinking first appeared, for the elapsed-seconds shimmer. */
  startedAt: number;
  /** true while still streaming reasoning; false once the answer text begins. */
  active: boolean;
}

/** Live "Using X…" status line derived from tool.generating / tool.start. */
export interface ActivityLine {
  label: string;
  context?: string;
}

export interface ClarifyPrompt {
  requestId: string;
  question: string;
  choices: string[];
}

export interface ApprovalPrompt {
  requestId?: string;
  command: string;
}

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  tools?: ToolChip[];
  thinking?: ThinkingBlock;
  activity?: ActivityLine;
  clarify?: ClarifyPrompt;
  approval?: ApprovalPrompt;
  error?: boolean;
  /** epoch ms the assistant turn began streaming (for elapsed display). */
  startedAt?: number;
}

/** A past/stored session for an agent, as shown in the per-agent switcher. */
export interface SessionMeta {
  /** Stored session key (session.list `id`) — stable across resumes. */
  key: string;
  title: string;
  preview: string;
  startedAt: number;
  messageCount: number;
}

/** Everything that is per-chat (one per agent). */
export interface ChatSlot {
  agentId: string;
  /** Live gateway session id (events route by this). Null until created. */
  sessionId: string | null;
  /** Stored session key (session.list id) backing the live session, if known. */
  sessionKey: string | null;
  connecting: boolean;
  streaming: boolean;
  messages: ChatMsg[];
  statusText: string | null;
  /** The unanswered clarify (if any). While set, the composer routes to it. */
  pendingClarify: ClarifyPrompt | null;
  /** True while this chat has streamed content the user hasn't viewed. */
  unread: boolean;
  /** This agent's stored sessions (for the session switcher). */
  sessions: SessionMeta[];
  /** True once we've fetched this agent's session list at least once. */
  sessionsLoaded: boolean;
  /** This agent's own profile's current model + provider (display + next-session default). */
  model: string | null;
  provider: string | null;
  /** True only after the founder explicitly picked a model via setModel for
   * THIS agent — an adopted display id from session.info is not pinned. */
  modelPinned: boolean;
}

function newSlot(agentId: string): ChatSlot {
  return {
    agentId,
    sessionId: null,
    sessionKey: null,
    connecting: false,
    streaming: false,
    messages: [],
    statusText: null,
    pendingClarify: null,
    unread: false,
    sessions: [],
    sessionsLoaded: false,
    model: null,
    provider: null,
    modelPinned: false,
  };
}

/** The real Hermes profile backing an agent's chat: cofounder itself, or its own role profile. */
function agentProfile(agentId: string): string {
  const agent = agentById(agentId);
  return agent.orchestrator ? COFOUNDER_PROFILE : roleProfileName(agentId);
}

interface ChatState {
  /** Per-agent chat slots, keyed by agent id ("cofounder" | role id). */
  chats: Record<string, ChatSlot>;
  /** Which chat is currently on screen. */
  activeAgent: string;
  /** Shared, chat-agnostic UI notice (model errors etc.). */
  notice: string | null;

  setActiveAgent: (agentId: string) => void;
  clearNotice: () => void;
  /** Pick a model for the ACTIVE chat's own profile; applies to its next session. */
  setModel: (model: string, provider: string) => Promise<void>;

  // ── Active-chat operations (delegate to the agent-scoped variants below) ──
  ensureSession: () => Promise<string>;
  /**
   * Send to the active chat. `text` is what the USER BUBBLE renders; the
   * optional `promptText` is what's actually submitted to the model (used for
   * task-tag expansion — the bubble keeps `#[Title]`, the model gets the
   * bracketed context line). Defaults to `text`.
   */
  send: (text: string, promptText?: string) => Promise<void>;
  answerClarify: (requestId: string, answer: string) => Promise<void>;
  respondApproval: (choice: "allow" | "deny", all?: boolean) => Promise<void>;
  interrupt: () => Promise<void>;

  // ── Agent-scoped variants (used by the active-chat wrappers + directly) ──
  ensureSessionFor: (agentId: string) => Promise<string>;
  sendTo: (agentId: string, text: string, promptText?: string) => Promise<void>;

  // ── Sessions-per-agent ──
  /** Refresh the given agent's stored session list from session.list. */
  loadSessions: (agentId: string) => Promise<void>;
  /** Start a brand-new empty session for the agent (persona-seeded for roles). */
  newSession: (agentId: string) => Promise<void>;
  /** Switch the agent to a stored session: resume it + render its history. */
  switchSession: (agentId: string, key: string) => Promise<void>;
  /** Delete a stored session (must not be the live/active one). */
  deleteSession: (agentId: string, key: string) => Promise<void>;
}

let subscribed = false;
let uid = 0;
const nextId = () => `m${Date.now()}_${++uid}`;

// ── active-session persistence (per agent) ───────────────────────────────────

function loadActiveSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistActiveSession(agentId: string, key: string | null): void {
  try {
    const map = loadActiveSessions();
    if (key) map[agentId] = key;
    else delete map[agentId];
    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(map));
  } catch {
    /* private-mode / quota — non-fatal */
  }
}

// ── titles: encode the agent into the title so session.list can be filtered ──

/** Build the create-time title, e.g. "Marketing — Jul 4". */
function sessionTitle(agentId: string): string {
  const label = agentById(agentId).label;
  const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${label} — ${date}`;
}

/** Which agent owns a stored session, parsed from its title tag. Null if none. */
function agentForTitle(title: string): string | null {
  const head = (title.split("—")[0] ?? "").trim().toLowerCase();
  if (!head) return null;
  const match = AGENTS.find((a) => a.label.toLowerCase() === head);
  return match ? match.id : null;
}

/**
 * Build the seed history for a *recreated* session: the last CONTEXT_SEED_CAP
 * rendered turns of this slot, so a model switch / reconnect keeps the
 * conversation's context. No persona seed needed — a role's persona lives in
 * its own profile's SOUL. Rendered messages only carry user/assistant text —
 * exactly the shape session.create accepts.
 */
function contextSeed(_agentId: string, msgs: ChatMsg[]): ChatMessage[] {
  return msgs
    .filter((m) => m.text.trim() && !m.error)
    .slice(-CONTEXT_SEED_CAP)
    .map((m) => ({ role: m.role, content: m.text })) as ChatMessage[];
}

const initialChats: Record<string, ChatSlot> = Object.fromEntries(
  AGENTS.map((a) => [a.id, newSlot(a.id)]),
);

export const useChat = create<ChatState>((set, get) => ({
  chats: initialChats,
  activeAgent: "cofounder",
  notice: null,

  clearNotice: () => set({ notice: null }),

  setActiveAgent: (agentId: string) => {
    if (!get().chats[agentId]) return;
    set((s) => ({
      activeAgent: agentId,
      chats: { ...s.chats, [agentId]: { ...s.chats[agentId], unread: false } },
    }));
  },

  setModel: async (model: string, provider: string) => {
    const agentId = get().activeAgent;
    const prevSlot = get().chats[agentId];
    const prev = { model: prevSlot?.model ?? null, provider: prevSlot?.provider ?? null };
    // Optimistic UI, scoped to THIS agent's own profile — each role has its
    // own profile now, so a model choice on one chat must not touch another's.
    // Drop the LIVE session so it recreates on next send with the new model;
    // keep `messages` + clear sessionKey so ensureSessionFor re-seeds context
    // into the fresh session (a mid-run switch would corrupt the active stream
    // otherwise).
    patchChat(set, agentId, () => ({
      model,
      provider,
      modelPinned: true,
      sessionId: null,
      sessionKey: null,
    }));
    // The recreated session is a new stored row; forget the persisted active
    // so startup doesn't try to resume a superseded key.
    persistActiveSession(agentId, null);
    logEvent("info", "model", `setModel(${agentId}) ${provider}/${model}`);
    try {
      await hermesRest.setProfileModel(agentProfile(agentId), provider, model);
    } catch (err) {
      patchChat(set, agentId, () => ({ ...prev }));
      set({ notice: `Couldn't set model: ${String(err)}` });
      logEvent("error", "model", `setProfileModel failed: ${String(err)}`);
    }
  },

  ensureSessionFor: async (agentId: string) => {
    const existing = get().chats[agentId]?.sessionId;
    if (existing) return existing;
    patchChat(set, agentId, () => ({ connecting: true }));
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      subscribeEvents();

      const slot = get().chats[agentId];
      // Try to resume a persisted stored session first, so a chat survives WS
      // reconnects / app restarts instead of always creating a fresh, empty one.
      const persistedKey = slot?.sessionKey ?? loadActiveSessions()[agentId];
      if (persistedKey) {
        const resumed = await tryResume(set, get, agentId, persistedKey);
        if (resumed) return resumed;
      }

      const sid = await createSessionFor(set, get, agentId, contextSeed(agentId, slot?.messages ?? []));
      return sid;
    } catch (err) {
      patchChat(set, agentId, () => ({ connecting: false }));
      set({ notice: `Couldn't start ${agentById(agentId).label}: ${String(err)}` });
      throw err;
    }
  },

  ensureSession: () => get().ensureSessionFor(get().activeAgent),

  sendTo: async (agentId: string, text: string, promptText?: string) => {
    const clean = text.trim();
    if (!clean) return;
    // What the model receives (task-tag-expanded); falls back to the bubble text.
    const prompt = (promptText ?? text).trim() || clean;
    const chat = get().chats[agentId];
    if (!chat) return;
    // If a clarify is pending in this chat, a "send" IS the answer.
    if (chat.pendingClarify) {
      await answerClarifyFor(get, set, agentId, chat.pendingClarify.requestId, prompt);
      return;
    }
    // Never fire prompt.submit while a run is in flight (would deadlock / no-op).
    if (chat.streaming) return;
    patchChat(set, agentId, (c) => ({
      messages: [...c.messages, { id: nextId(), role: "user", text: clean }],
    }));
    set({ notice: null });
    try {
      const sid = await get().ensureSessionFor(agentId);
      // Seed the assistant placeholder now so the UI shows a typing bubble.
      patchChat(set, agentId, (c) => ({
        streaming: true,
        statusText: null,
        messages: [
          ...c.messages,
          { id: nextId(), role: "assistant", text: "", streaming: true, tools: [], startedAt: Date.now() },
        ],
      }));
      logEvent("info", "session", `prompt.submit → ${agentId} (${sid})`);
      await sessions.submitPrompt(sid, prompt);
      armWatchdog(set, get, agentId, sid);
    } catch (err) {
      logEvent("error", "session", `send failed (${agentId}): ${String(err)}`);
      patchChat(set, agentId, (c) => ({
        streaming: false,
        messages: patchLastAssistant(c.messages, (m) => ({
          ...m,
          streaming: false,
          error: true,
          text: m.text || `Send failed: ${String(err)}`,
        })),
      }));
    }
  },

  send: (text: string, promptText?: string) =>
    get().sendTo(get().activeAgent, text, promptText),

  answerClarify: (requestId: string, answer: string) =>
    answerClarifyFor(get, set, get().activeAgent, requestId, answer),

  respondApproval: async (choice, all = false) => {
    const agentId = get().activeAgent;
    const sid = get().chats[agentId]?.sessionId;
    patchChat(set, agentId, (c) => ({
      messages: c.messages.map((m) => (m.approval ? { ...m, approval: undefined } : m)),
    }));
    if (!sid) return;
    try {
      await sessions.respondApproval(sid, choice, all);
    } catch (err) {
      set({ notice: `Approval failed: ${String(err)}` });
    }
  },

  interrupt: async () => {
    const agentId = get().activeAgent;
    await interruptFor(set, get, agentId);
  },

  // ── Sessions-per-agent ──────────────────────────────────────────────────

  loadSessions: async (agentId: string) => {
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      const res = await sessions.list(200);
      const mine = (res.sessions ?? [])
        .filter((s: SessionListItem) => (s.source || "").toLowerCase() === APP_SOURCE)
        .filter((s: SessionListItem) => agentForTitle(s.title) === agentId)
        .map(
          (s: SessionListItem): SessionMeta => ({
            key: s.id,
            title: s.title,
            preview: s.preview,
            startedAt: s.started_at,
            messageCount: s.message_count,
          }),
        );
      patchChat(set, agentId, () => ({ sessions: mine, sessionsLoaded: true }));
    } catch (err) {
      logEvent("warn", "session", `loadSessions(${agentId}) failed: ${String(err)}`);
      patchChat(set, agentId, () => ({ sessionsLoaded: true }));
    }
  },

  newSession: async (agentId: string) => {
    // Detach from any live/persisted session and clear the thread, then create.
    persistActiveSession(agentId, null);
    patchChat(set, agentId, () => ({
      sessionId: null,
      sessionKey: null,
      messages: [],
      streaming: false,
      pendingClarify: null,
      statusText: null,
    }));
    try {
      await createSessionFor(set, get, agentId, []);
      await get().loadSessions(agentId);
    } catch (err) {
      set({ notice: `Couldn't start a new session: ${String(err)}` });
    }
  },

  switchSession: async (agentId: string, key: string) => {
    if (get().chats[agentId]?.sessionKey === key && get().chats[agentId]?.sessionId) return;
    patchChat(set, agentId, () => ({
      connecting: true,
      messages: [],
      streaming: false,
      pendingClarify: null,
      statusText: null,
    }));
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      subscribeEvents();
      const ok = await tryResume(set, get, agentId, key);
      if (!ok) throw new Error("resume returned no session");
    } catch (err) {
      patchChat(set, agentId, () => ({ connecting: false }));
      set({ notice: `Couldn't open that session: ${String(err)}` });
    }
  },

  deleteSession: async (agentId: string, key: string) => {
    const slot = get().chats[agentId];
    // Deleting the currently-open session: detach it first (the backend refuses
    // to delete a live session). We close the live session then delete the row.
    const isActive = slot?.sessionKey === key;
    try {
      if (isActive && slot?.sessionId) {
        try {
          await sessions.close(slot.sessionId);
        } catch {
          /* best-effort — the delete still needs it detached */
        }
        persistActiveSession(agentId, null);
        patchChat(set, agentId, () => ({
          sessionId: null,
          sessionKey: null,
          messages: [],
          streaming: false,
          pendingClarify: null,
          statusText: null,
        }));
      }
      await sessions.delete(key);
    } catch (err) {
      set({ notice: `Couldn't delete session: ${String(err)}` });
      logEvent("warn", "session", `delete(${key}) failed: ${String(err)}`);
    }
    await get().loadSessions(agentId);
  },
}));

// ── session lifecycle helpers ────────────────────────────────────────────────

/**
 * Create a fresh live session for an agent with the given seed history. Sets
 * cwd to the configured workspace, tags source + title so it's discoverable via
 * session.list, and applies a user-pinned model override. Drops
 * close_on_disconnect so the stored session survives WS drops and can resume.
 */
async function createSessionFor(
  set: ZSet,
  get: () => ChatState,
  agentId: string,
  seed: ChatMessage[],
): Promise<string> {
  const slot = get().chats[agentId];
  const { model, provider, modelPinned } = slot ?? { model: null, provider: null, modelPinned: false };
  const cwd = loadConfig()?.workspaceRoot;
  const res = await sessions.create({
    profile: agentProfile(agentId),
    source: APP_SOURCE,
    // Persist the workspace root so agent file writes land where the founder
    // configured, not in the gateway's launch dir (~/Cofounder-Workspace).
    ...(cwd ? { cwd } : {}),
    // A title is required to route session.list back to this agent — tag every
    // session, orchestrator included.
    title: sessionTitle(agentId),
    ...(seed.length ? { messages: seed } : {}),
    // Only send a model override the founder picked FOR THIS agent — an
    // adopted display id (e.g. "deepseek-v4-flash-free") is not a valid
    // create-time model id.
    ...(modelPinned && model ? { model } : {}),
    ...(modelPinned && provider ? { provider } : {}),
  });
  logEvent("info", "session", `session.create ok ${agentId}`, {
    profile: agentProfile(agentId),
    session_id: res.session_id,
    key: res.stored_session_id,
    cwd: res.info?.cwd,
  });
  persistActiveSession(agentId, res.stored_session_id);
  patchChat(set, agentId, (c) => ({
    // Adopt the session's actual model as this agent's display source of truth.
    model: (res.info?.model as string | undefined) ?? c.model,
    provider: (res.info?.provider as string | undefined) ?? c.provider,
    sessionId: res.session_id,
    sessionKey: res.stored_session_id,
    connecting: false,
  }));
  return res.session_id;
}

/**
 * Resume a stored session (by its stable key) into the agent's slot. Returns
 * the new live session_id, or null on failure. session.resume returns a fresh
 * live id plus the full display transcript, which we render into the thread
 * (mapping {role,text} history entries to ChatMsg; tool-only entries drop out).
 */
async function tryResume(
  set: ZSet,
  get: () => ChatState,
  agentId: string,
  key: string,
): Promise<string | null> {
  try {
    const res = await sessions.resume(key, { profile: agentProfile(agentId) });
    const rendered = historyToChatMsgs(res.messages ?? []);
    persistActiveSession(agentId, res.session_key || key);
    set((s) => ({
      chats: {
        ...s.chats,
        [agentId]: {
          ...s.chats[agentId],
          sessionId: res.session_id,
          sessionKey: res.session_key || key,
          connecting: false,
          messages: rendered,
          streaming: false,
          pendingClarify: null,
          statusText: null,
        },
      },
    }));
    logEvent("info", "session", `resume ok ${agentId}`, {
      key,
      session_id: res.session_id,
      count: rendered.length,
    });
    return res.session_id;
  } catch (err) {
    logEvent("warn", "session", `resume(${key}) failed: ${String(err)}`);
    // Forget a stale persisted key so we fall back to a fresh create.
    if (get().chats[agentId]?.sessionKey === key) persistActiveSession(agentId, null);
    return null;
  }
}

/**
 * Map session.history / session.resume `messages` to renderable ChatMsg. The
 * backend returns user/assistant entries as {role, text} and tool entries as
 * {role:"tool", name, context}; we render only the user/assistant text, which
 * skips the invisible persona-seed pair too (it carries a fixed assistant ack —
 * we keep it since it reads as a benign greeting, but drop tool rows).
 */
function historyToChatMsgs(messages: Array<{ role?: string; text?: unknown }>): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = typeof m.text === "string" ? m.text : "";
    if (!text.trim()) continue;
    out.push({ id: nextId(), role: m.role, text });
  }
  return out;
}

/** Shared clarify handler used by both the active + agent-scoped entry points. */
async function answerClarifyFor(
  get: () => ChatState,
  set: ZSet,
  agentId: string,
  requestId: string,
  answer: string,
): Promise<void> {
  patchChat(set, agentId, (c) => ({
    pendingClarify: null,
    streaming: true,
    statusText: null,
    messages: [
      ...c.messages.map((m) =>
        m.clarify?.requestId === requestId ? { ...m, clarify: undefined } : m,
      ),
      { id: nextId(), role: "user", text: answer },
      { id: nextId(), role: "assistant", text: "", streaming: true, tools: [], startedAt: Date.now() },
    ],
  }));
  try {
    await sessions.respondClarify(requestId, answer);
    const sid = get().chats[agentId]?.sessionId;
    if (sid) armWatchdog(set, get, agentId, sid);
  } catch (err) {
    set({ notice: `Clarify failed: ${String(err)}` });
    patchChat(set, agentId, (c) => ({
      streaming: false,
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        streaming: false,
        error: true,
        text: m.text || "(clarify failed)",
      })),
    }));
  }
}

/**
 * Stop the agent's current run — reliably. session.interrupt is best-effort and
 * silently no-ops if the run thread is gone, so we ALSO: (a) interrupt any
 * active delegated sub-agents (subagent.interrupt per delegation.status entry),
 * (b) force the UI out of streaming and finalize the bubble even if every RPC
 * fails, and (c) recover the stuck case where the UI thinks it's streaming but
 * session.status reports the agent is idle. Every attempt is logged.
 */
async function interruptFor(set: ZSet, get: () => ChatState, agentId: string): Promise<void> {
  const slot = get().chats[agentId];
  const sid = slot?.sessionId ?? null;
  clearWatchdog(agentId);
  logEvent("info", "interrupt", `stop requested (${agentId})`, { session_id: sid, streaming: slot?.streaming });

  // (a) session.interrupt — always try when we have a live session.
  if (sid) {
    try {
      const res = await sessions.interrupt(sid);
      logEvent("info", "interrupt", `session.interrupt → ${res.status}`, { session_id: sid });
    } catch (err) {
      logEvent("warn", "interrupt", `session.interrupt failed: ${String(err)}`, { session_id: sid });
    }
    // (b) delegated sub-agents keep running even after the parent turn stops —
    // ask each active one to stop too.
    try {
      const deleg = await sessions.delegationStatus();
      const active = Array.isArray(deleg.active) ? deleg.active : [];
      for (const entry of active) {
        const subId = String((entry as { subagent_id?: unknown })?.subagent_id ?? "").trim();
        if (!subId) continue;
        try {
          const r = await sessions.interruptSubagent(subId);
          logEvent("info", "interrupt", `subagent.interrupt ${subId}`, r);
        } catch (err) {
          logEvent("warn", "interrupt", `subagent.interrupt ${subId} failed: ${String(err)}`);
        }
      }
    } catch (err) {
      logEvent("warn", "interrupt", `delegation.status failed: ${String(err)}`, String(err));
    }
  }

  // (c) always finalize the bubble locally — never leave a stuck spinner.
  patchChat(set, agentId, (c) => ({
    streaming: false,
    statusText: null,
    pendingClarify: null,
    messages: patchLastAssistant(c.messages, (m) =>
      m.streaming
        ? {
            ...m,
            streaming: false,
            activity: undefined,
            thinking: m.thinking ? { ...m.thinking, active: false } : undefined,
            text: m.text || "(interrupted)",
          }
        : m,
    ),
  }));
}

/**
 * Recover a stuck-streaming slot: if the UI still shows a run but session.status
 * reports the agent is idle, the stream was silently dropped — clear it. Used by
 * the watchdog and callable on demand. Best-effort; never throws.
 */
async function reconcileStreaming(set: ZSet, get: () => ChatState, agentId: string): Promise<boolean> {
  const slot = get().chats[agentId];
  const sid = slot?.sessionId;
  if (!slot?.streaming || !sid) return false;
  try {
    const res = await sessions.status(sid);
    const running = /Agent Running:\s*Yes/i.test(res.output || "");
    logEvent("info", "watchdog", `status(${agentId}): ${running ? "running" : "idle"}`);
    if (!running) {
      patchChat(set, agentId, (c) => ({
        streaming: false,
        statusText: null,
        messages: patchLastAssistant(c.messages, (m) =>
          m.streaming
            ? { ...m, streaming: false, activity: undefined, thinking: m.thinking ? { ...m.thinking, active: false } : undefined }
            : m,
        ),
      }));
      return true;
    }
  } catch (err) {
    logEvent("warn", "watchdog", `status(${agentId}) failed: ${String(err)}`);
  }
  return false;
}

// ── watchdog: no-response detection after prompt.submit ──────────────────────

const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
/** Live session id being watched per agent, and whether a stream event landed. */
const watchdogSids = new Map<string, string>();
/** Consecutive silent rounds per agent, reset whenever stream activity lands. */
const watchdogRounds = new Map<string, number>();

function clearWatchdog(agentId: string): void {
  const t = watchdogs.get(agentId);
  if (t) clearTimeout(t);
  watchdogs.delete(agentId);
  watchdogSids.delete(agentId);
  watchdogRounds.delete(agentId);
}

/**
 * Arm the per-agent watchdog after a successful prompt.submit: if no stream
 * event (message.start/delta, thinking, tool.*) arrives for this session within
 * WATCHDOG_MS, check session.status. If the agent reports idle, clear the stuck
 * spinner (reconcileStreaming). If it still reports running, re-arm for another
 * round rather than going silent forever — after WATCHDOG_MAX_ROUNDS with no
 * activity at all, give up and force-stop the run with a visible error so the
 * UI never just sits on "loading" indefinitely.
 */
function armWatchdog(set: ZSet, get: () => ChatState, agentId: string, sid: string): void {
  clearWatchdog(agentId);
  watchdogSids.set(agentId, sid);
  watchdogRounds.set(agentId, 0);
  scheduleWatchdogRound(set, get, agentId, sid);
}

function scheduleWatchdogRound(set: ZSet, get: () => ChatState, agentId: string, sid: string): void {
  watchdogs.set(
    agentId,
    setTimeout(() => {
      watchdogs.delete(agentId);
      // Stream may have already ended cleanly.
      if (!get().chats[agentId]?.streaming || get().chats[agentId]?.sessionId !== sid) {
        watchdogRounds.delete(agentId);
        watchdogSids.delete(agentId);
        return;
      }
      const round = (watchdogRounds.get(agentId) ?? 0) + 1;
      watchdogRounds.set(agentId, round);
      logEvent("warn", "watchdog", `no response from ${agentId} in ${(WATCHDOG_MS * round) / 1000}s (round ${round})`, { session_id: sid });
      set({
        notice: `${agentById(agentId).label}: no response from the model yet — check Logs / model config.`,
      });
      void reconcileStreaming(set, get, agentId).then((cleared) => {
        if (cleared) {
          watchdogRounds.delete(agentId);
          watchdogSids.delete(agentId);
          return;
        }
        if (round >= WATCHDOG_MAX_ROUNDS) {
          // Gave it multiple full rounds with zero stream activity and a
          // "running" status that never resolves — treat as wedged, not just
          // slow, and hand control back to the user instead of spinning forever.
          logEvent("error", "watchdog", `giving up on ${agentId} after ${round} silent rounds`, { session_id: sid });
          set({
            notice: `${agentById(agentId).label}: gave up waiting for a response — the run may be stuck. Try again or check the model config.`,
          });
          patchChat(set, agentId, (c) => ({
            streaming: false,
            statusText: null,
            messages: patchLastAssistant(c.messages, (m) =>
              m.streaming
                ? { ...m, streaming: false, error: true, activity: undefined, text: m.text || "(no response — the run appears stuck)" }
                : m,
            ),
          }));
          watchdogRounds.delete(agentId);
          watchdogSids.delete(agentId);
          return;
        }
        if (get().chats[agentId]?.streaming && get().chats[agentId]?.sessionId === sid) {
          scheduleWatchdogRound(set, get, agentId, sid);
        }
      });
    }, WATCHDOG_MS),
  );
}

/** A stream event for `sid` arrived — the model is responding; disarm. */
function noteStreamActivity(agentId: string): void {
  if (watchdogs.has(agentId)) clearWatchdog(agentId);
}

// ── slot helpers ────────────────────────────────────────────────────────────

type ZSet = (
  partial:
    | Partial<ChatState>
    | ((s: ChatState) => Partial<ChatState>),
) => void;

/** Immutably patch a single chat slot by id. */
function patchChat(
  set: ZSet,
  agentId: string,
  fn: (c: ChatSlot) => Partial<ChatSlot>,
): void {
  set((s) => {
    const cur = s.chats[agentId];
    if (!cur) return {};
    return { chats: { ...s.chats, [agentId]: { ...cur, ...fn(cur) } } };
  });
}

/** Find the chat slot that owns a given live session_id (or null). */
function chatForSession(sid: string | undefined): string | null {
  if (!sid) return null;
  const chats = useChat.getState().chats;
  for (const id of Object.keys(chats)) {
    if (chats[id].sessionId === sid) return id;
  }
  return null;
}

function patchLastAssistant(msgs: ChatMsg[], fn: (m: ChatMsg) => ChatMsg): ChatMsg[] {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") {
      const copy = [...msgs];
      copy[i] = fn(copy[i]);
      return copy;
    }
  }
  return msgs;
}

/**
 * Route an event to its owning chat. The gateway multiplexes every session's
 * events onto one socket, so we resolve the target chat by session_id. Events
 * with no session_id (global/gateway frames) are ignored by the per-chat
 * handlers. Returns the owning agent id, or null if the event isn't ours.
 */
function routeAgent(ev: HermesEvent): string | null {
  return chatForSession(ev.session_id);
}

/** Mark a chat unread if it isn't the one currently on screen. */
function markUnread(set: ZSet, agentId: string): void {
  const active = useChat.getState().activeAgent;
  if (agentId !== active) patchChat(set, agentId, () => ({ unread: true }));
}

/** Wire the WS event stream into the store exactly once. */
function subscribeEvents(): void {
  if (subscribed) return;
  subscribed = true;
  // Diagnostic ring-buffer trail (rpc/event/ws state) — install once alongside
  // the event wiring so the Logs drawer has data from first connect.
  installWsLogging();
  const { setState, getState } = useChat;
  const set: ZSet = setState;

  hermesWs.onEvent("message.start", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    patchChat(set, agentId, (c) => {
      const last = c.messages[c.messages.length - 1];
      if (last && last.role === "assistant" && last.streaming) return { streaming: true };
      return {
        streaming: true,
        messages: [
          ...c.messages,
          { id: nextId(), role: "assistant", text: "", streaming: true, tools: [], startedAt: Date.now() },
        ],
      };
    });
    markUnread(set, agentId);
  });

  hermesWs.onEvent("message.delta", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as MessageDeltaPayload | undefined;
    if (!p?.text) return;
    patchChat(set, agentId, (c) => ({
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        text: m.text + p.text,
        thinking: m.thinking ? { ...m.thinking, active: false } : undefined,
        activity: undefined,
      })),
    }));
    markUnread(set, agentId);
  });

  const onThinking = (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as ThinkingDeltaPayload | undefined;
    if (!p?.text) return;
    patchChat(set, agentId, (c) => ({
      streaming: true,
      messages: patchLastAssistant(c.messages, (m) => {
        const prev = m.thinking?.text ?? "";
        let next = prev + p.text;
        if (next.length > THINKING_CAP) next = next.slice(next.length - THINKING_CAP);
        return {
          ...m,
          thinking: { text: next, startedAt: m.thinking?.startedAt ?? Date.now(), active: true },
        };
      }),
    }));
  };
  hermesWs.onEvent("thinking.delta", onThinking);
  hermesWs.onEvent("reasoning.delta", onThinking);

  hermesWs.onEvent("message.complete", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as MessageCompletePayload | undefined;
    patchChat(set, agentId, (c) => ({
      streaming: false,
      statusText: null,
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        streaming: false,
        activity: undefined,
        thinking: m.thinking ? { ...m.thinking, active: false } : undefined,
        text: p?.text ?? m.text,
        error: p?.status === "error" ? true : m.error,
      })),
    }));
    markUnread(set, agentId);
  });

  hermesWs.onEvent("status.update", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    const p = ev.payload as StatusUpdatePayload | undefined;
    if (p?.text) patchChat(set, agentId, () => ({ statusText: p.text }));
  });

  hermesWs.onEvent("tool.generating", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as ToolGeneratingPayload | undefined;
    const name = p?.name;
    if (!name) return;
    patchChat(set, agentId, (c) => ({
      streaming: true,
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        activity: { label: `Using ${name}…` },
      })),
    }));
  });

  hermesWs.onEvent("tool.start", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = (ev.payload ?? {}) as ToolStartPayload;
    const label = p.name || "tool";
    const id = String(p.tool_id ?? `${label}-${Date.now()}`);
    patchChat(set, agentId, (c) => ({
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        activity: { label: `Using ${label}…`, context: p.context || undefined },
        tools: [...(m.tools ?? []), { id, label, status: "running" }],
      })),
    }));
  });

  hermesWs.onEvent("tool.complete", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    const p = (ev.payload ?? {}) as ToolCompletePayload;
    const id = p.tool_id != null ? String(p.tool_id) : null;
    patchChat(set, agentId, (c) => ({
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        activity: undefined,
        tools: (m.tools ?? []).map((t) =>
          id == null || t.id === id ? { ...t, status: "done" as const } : t,
        ),
      })),
    }));
  });

  hermesWs.onEvent("clarify.request", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as ClarifyRequestPayload | undefined;
    if (!p?.question || !p.request_id) return;
    const prompt: ClarifyPrompt = {
      requestId: p.request_id,
      question: p.question,
      choices: p.choices ?? [],
    };
    patchChat(set, agentId, (c) => ({
      streaming: false,
      statusText: null,
      pendingClarify: prompt,
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        streaming: false,
        activity: undefined,
        thinking: m.thinking ? { ...m.thinking, active: false } : undefined,
        clarify: prompt,
      })),
    }));
    markUnread(set, agentId);
  });

  hermesWs.onEvent("approval.request", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as ApprovalRequestPayload | undefined;
    if (!p) return;
    patchChat(set, agentId, (c) => ({
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        approval: { requestId: p.request_id, command: p.command ?? "(command)" },
      })),
    }));
    markUnread(set, agentId);
  });

  hermesWs.onEvent("error", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
    noteStreamActivity(agentId);
    const p = ev.payload as ErrorEventPayload | undefined;
    set({ notice: p?.message ?? "Backend error" });
    patchChat(set, agentId, (c) => ({
      streaming: false,
      statusText: null,
      messages: patchLastAssistant(c.messages, (m) =>
        m.streaming ? { ...m, streaming: false, error: true, activity: undefined } : m,
      ),
    }));
  });

  // On WS drop, clear the LIVE session id (events would misroute otherwise) but
  // KEEP the messages + persisted sessionKey so the next ensureSessionFor
  // resumes the stored session (survives reconnects) instead of losing context.
  hermesWs.onState((st) => {
    if (st === "closed" || st === "error") {
      for (const a of AGENTS) clearWatchdog(a.id);
      const chats = getState().chats;
      if (Object.values(chats).some((c) => c.sessionId)) {
        setState((s) => ({
          chats: Object.fromEntries(
            Object.entries(s.chats).map(([k, c]) => [
              k,
              { ...c, sessionId: null, pendingClarify: null, streaming: false },
            ]),
          ),
        }));
      }
    }
  });
}
