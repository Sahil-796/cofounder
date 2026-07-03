/**
 * Multi-agent chat store. Owns N named chats — the `cofounder` orchestrator
 * (default) plus one per role (marketing, research, support, operations,
 * finance). Each chat is its own live Hermes session on the `cofounder`
 * profile; role sessions adopt their persona by seeding an invisible
 * system-style history on session.create (the seed lives in backend history
 * only — it's never added to the rendered thread). Events are routed to the
 * owning chat by session_id.
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
  StatusUpdatePayload,
  ThinkingDeltaPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ToolStartPayload,
} from "@/lib/hermes";
import type { ChatMessage } from "@/lib/hermes";
import { COFOUNDER_PROFILE } from "@/lib/cofounder/bootstrap";
import { AGENTS, agentById } from "@/lib/cofounder/roles";

/** Cap on stored thinking text so a long reasoning trace can't bloat memory. */
const THINKING_CAP = 20_000;

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

/** Everything that is per-chat (one per agent). */
export interface ChatSlot {
  agentId: string;
  sessionId: string | null;
  connecting: boolean;
  streaming: boolean;
  messages: ChatMsg[];
  statusText: string | null;
  /** The unanswered clarify (if any). While set, the composer routes to it. */
  pendingClarify: ClarifyPrompt | null;
  /** True while this chat has streamed content the user hasn't viewed. */
  unread: boolean;
}

function newSlot(agentId: string): ChatSlot {
  return {
    agentId,
    sessionId: null,
    connecting: false,
    streaming: false,
    messages: [],
    statusText: null,
    pendingClarify: null,
    unread: false,
  };
}

interface ChatState {
  /** Per-agent chat slots, keyed by agent id ("cofounder" | role id). */
  chats: Record<string, ChatSlot>;
  /** Which chat is currently on screen. */
  activeAgent: string;
  /** Shared, chat-agnostic UI notice (model errors etc.). */
  notice: string | null;
  /** Currently-selected model id + provider (applies to the next session of
   * whichever chat is active). Shared across chats — it's the profile default. */
  model: string | null;
  provider: string | null;
  /** True only after the user explicitly picked a model via setModel. Display
   * models adopted from session.info are NOT pinned — feeding a short display
   * id back into session.create as an override 400s on the backend. */
  modelPinned: boolean;

  setActiveAgent: (agentId: string) => void;
  clearNotice: () => void;
  /** Pick a model: persist as profile default + apply to future sessions. */
  setModel: (model: string, provider: string) => Promise<void>;

  // ── Active-chat operations (delegate to the agent-scoped variants below) ──
  ensureSession: () => Promise<string>;
  send: (text: string) => Promise<void>;
  answerClarify: (requestId: string, answer: string) => Promise<void>;
  respondApproval: (choice: "allow" | "deny", all?: boolean) => Promise<void>;
  interrupt: () => Promise<void>;

  // ── Agent-scoped variants (used by the active-chat wrappers + directly) ──
  ensureSessionFor: (agentId: string) => Promise<string>;
  sendTo: (agentId: string, text: string) => Promise<void>;
}

let subscribed = false;
let uid = 0;
const nextId = () => `m${Date.now()}_${++uid}`;

/** Seed the role persona invisibly via session.create's `messages` param. */
function personaSeed(agentId: string): ChatMessage[] | undefined {
  const agent = agentById(agentId);
  if (agent.orchestrator) return undefined;
  const role = agent.id;
  return [
    {
      role: "user",
      content:
        `You are acting as the ${role} agent for this company. ` +
        `Load and follow your ${role} skill and its workspace conventions. ` +
        `Stay in the ${role} role for this entire conversation — answer as the ${role} specialist, ` +
        `not as the general orchestrator.`,
    },
    {
      role: "assistant",
      content: `Understood — I'm your ${role} agent. How can I help with ${role}?`,
    },
  ] as ChatMessage[];
}

const initialChats: Record<string, ChatSlot> = Object.fromEntries(
  AGENTS.map((a) => [a.id, newSlot(a.id)]),
);

export const useChat = create<ChatState>((set, get) => ({
  chats: initialChats,
  activeAgent: "cofounder",
  notice: null,
  model: null,
  provider: null,
  modelPinned: false,

  clearNotice: () => set({ notice: null }),

  setActiveAgent: (agentId: string) => {
    if (!get().chats[agentId]) return;
    set((s) => ({
      activeAgent: agentId,
      chats: { ...s.chats, [agentId]: { ...s.chats[agentId], unread: false } },
    }));
  },

  setModel: async (model: string, provider: string) => {
    const prev = { model: get().model, provider: get().provider };
    // Optimistic UI. New sessions bind this via session.create's model param;
    // drop every chat's session so each recreates on next send with the new
    // model (a mid-run switch would corrupt the active stream otherwise).
    set((s) => ({
      model,
      provider,
      modelPinned: true,
      chats: Object.fromEntries(
        Object.entries(s.chats).map(([k, c]) => [k, { ...c, sessionId: null }]),
      ),
    }));
    try {
      await hermesRest.setProfileModel(COFOUNDER_PROFILE, provider, model);
    } catch (err) {
      set({ ...prev, notice: `Couldn't set model: ${String(err)}` });
    }
  },

  ensureSessionFor: async (agentId: string) => {
    const existing = get().chats[agentId]?.sessionId;
    if (existing) return existing;
    patchChat(set, agentId, () => ({ connecting: true }));
    try {
      if (hermesWs.connectionState !== "open") await hermesWs.connect();
      subscribeEvents();
      const { model, provider, modelPinned } = get();
      const agent = agentById(agentId);
      const res = await sessions.create({
        profile: COFOUNDER_PROFILE,
        source: "cofounder-app",
        close_on_disconnect: true,
        ...(agent.orchestrator ? {} : { title: agent.label }),
        ...(personaSeed(agentId) ? { messages: personaSeed(agentId) } : {}),
        // Only send a model override the USER picked — an adopted display id
        // (e.g. "deepseek-v4-flash-free") is not a valid create-time model id.
        ...(modelPinned && model ? { model } : {}),
        ...(modelPinned && provider ? { provider } : {}),
      });
      // NOTE: res.info.profile_name reflects the backend's LAUNCH profile, not
      // this session's binding — session.create binds HERMES_HOME to the
      // `profile` param's home each turn (verified in server.py). We don't use
      // it for detection; the onboarding gate guarantees the profile exists.
      set((s) => ({
        // Adopt the session's actual model as the display source of truth.
        model: (res.info?.model as string | undefined) ?? s.model,
        provider: (res.info?.provider as string | undefined) ?? s.provider,
        chats: {
          ...s.chats,
          [agentId]: { ...s.chats[agentId], sessionId: res.session_id, connecting: false },
        },
      }));
      return res.session_id;
    } catch (err) {
      patchChat(set, agentId, () => ({ connecting: false }));
      set({ notice: `Couldn't start ${agentById(agentId).label}: ${String(err)}` });
      throw err;
    }
  },

  ensureSession: () => get().ensureSessionFor(get().activeAgent),

  sendTo: async (agentId: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const chat = get().chats[agentId];
    if (!chat) return;
    // If a clarify is pending in this chat, a "send" IS the answer.
    if (chat.pendingClarify) {
      await answerClarifyFor(get, set, agentId, chat.pendingClarify.requestId, clean);
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
      await sessions.submitPrompt(sid, clean);
    } catch (err) {
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

  send: (text: string) => get().sendTo(get().activeAgent, text),

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
    const sid = get().chats[agentId]?.sessionId;
    if (!sid) return;
    try {
      await sessions.interrupt(sid);
    } catch {
      /* best-effort */
    }
    patchChat(set, agentId, (c) => ({
      streaming: false,
      statusText: null,
      pendingClarify: null,
      messages: patchLastAssistant(c.messages, (m) => ({
        ...m,
        streaming: false,
        activity: undefined,
        thinking: m.thinking ? { ...m.thinking, active: false } : undefined,
        text: m.text || "(interrupted)",
      })),
    }));
  },
}));

/** Shared clarify handler used by both the active + agent-scoped entry points. */
async function answerClarifyFor(
  _get: () => ChatState,
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
  const { setState, getState } = useChat;
  const set: ZSet = setState;

  hermesWs.onEvent("message.start", (ev: HermesEvent) => {
    const agentId = routeAgent(ev);
    if (!agentId) return;
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

  // Reset every chat's session on disconnect so they recreate on next send.
  hermesWs.onState((st) => {
    if (st === "closed" || st === "error") {
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
