/**
 * JSON-RPC 2.0 client over WebSocket for the Hermes tui_gateway (`/api/ws`).
 *
 * Wire protocol (verified against tui_gateway/ws.py + apps/shared client):
 *   request:  {"jsonrpc":"2.0","id":<id>,"method":<m>,"params":{...}}
 *   response: {"jsonrpc":"2.0","id":<id>,"result":{...}}  | {"error":{code,message}}
 *   event:    {"jsonrpc":"2.0","method":"event","params":{"type":..,"session_id":..,"payload":..}}
 *
 * Loopback needs no auth token, so `connect()` opens ws://127.0.0.1:9119/api/ws
 * directly. The server emits `gateway.ready` immediately on accept.
 *
 * Features: id correlation, per-request timeout, onEvent(type, cb) push
 * subscription, auto-reconnect with exponential backoff, connection-state
 * observable.
 */

import type { HermesEvent, HermesEventType, JsonRpcResponse } from "./types";
import { buildWsUrl, resolveSessionToken } from "./auth";
import { wsUrl } from "./base";

export type WsConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export const DEFAULT_WS_URL =
  typeof window !== "undefined" ? wsUrl() : "ws://127.0.0.1:9119/api/ws";

type EventHandler = (event: HermesEvent) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface HermesWsOptions {
  url?: string;
  /** Default per-request timeout (ms). Default 120s (matches reference client). */
  requestTimeoutMs?: number;
  /** Open handshake timeout (ms). Default 15s. */
  connectTimeoutMs?: number;
  /** Auto-reconnect on unexpected close. Default true. */
  autoReconnect?: boolean;
  /** Backoff bounds (ms). */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  socketFactory?: (url: string) => WebSocket;
  /**
   * Resolve the `/api/ws` auth token. The `/api/ws` upgrade requires a token
   * even on loopback (see auth.ts). Defaults to scraping it from hermes's
   * index.html over REST. Return "" to connect without a token (will 403).
   */
  tokenProvider?: () => Promise<string> | string;
}

const ANY = "*";

export class HermesWs {
  readonly url: string;
  private socket: WebSocket | null = null;
  private state: WsConnectionState = "idle";
  private nextId = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly stateHandlers = new Set<(s: WsConnectionState) => void>();
  private connectPromise: Promise<void> | null = null;

  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly autoReconnect: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly tokenProvider: () => Promise<string> | string;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wantOpen = false;

  constructor(opts: HermesWsOptions = {}) {
    this.url = opts.url ?? DEFAULT_WS_URL;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;
    this.autoReconnect = opts.autoReconnect ?? true;
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 15_000;
    this.socketFactory = opts.socketFactory ?? ((u) => new WebSocket(u));
    this.tokenProvider = opts.tokenProvider ?? (() => resolveSessionToken());
  }

  get connectionState(): WsConnectionState {
    return this.state;
  }

  /** Open the socket. Resolves on `open`. Idempotent while open/connecting. */
  connect(): Promise<void> {
    this.wantOpen = true;
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    // A connect already in flight (including a scheduled reconnect's `open()`)
    // must be awaited rather than resolved immediately — resolving early here
    // used to let callers race ahead to `request()` while the socket was still
    // CONNECTING, which fails fast with "gateway not connected" instead of
    // actually waiting for the handshake.
    if (this.connectPromise) return this.connectPromise;
    const p = this.open().finally(() => {
      if (this.connectPromise === p) this.connectPromise = null;
    });
    this.connectPromise = p;
    return p;
  }

  private async open(): Promise<void> {
    this.setState("connecting");

    // The /api/ws upgrade requires a token even on loopback (see auth.ts).
    let token = "";
    try {
      token = await this.tokenProvider();
    } catch {
      /* proceed tokenless — the upgrade will 403 and we surface it as error */
    }
    const url = buildWsUrl(this.url, token);

    let socket: WebSocket;
    try {
      socket = this.socketFactory(url);
    } catch (err) {
      this.setState("error");
      this.scheduleReconnect();
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.socket = socket;

    socket.addEventListener("message", (ev) => {
      if (this.socket !== socket) return;
      this.handleMessage((ev as MessageEvent).data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setState("closed");
      this.rejectAllPending(new Error("WebSocket closed"));
      if (this.wantOpen && this.autoReconnect) this.scheduleReconnect();
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        if (this.socket === socket) this.socket = null;
        this.setState("error");
        if (this.wantOpen && this.autoReconnect) this.scheduleReconnect();
        reject(new Error("WebSocket connection timeout"));
      }, this.connectTimeoutMs);

      socket.addEventListener(
        "open",
        () => {
          if (settled || this.socket !== socket) return;
          settled = true;
          clearTimeout(timer);
          this.reconnectAttempts = 0;
          this.setState("open");
          resolve();
        },
        { once: true },
      );

      socket.addEventListener(
        "error",
        () => {
          if (settled || this.socket !== socket) return;
          settled = true;
          clearTimeout(timer);
          this.setState("error");
          if (this.wantOpen && this.autoReconnect) this.scheduleReconnect();
          reject(new Error("WebSocket connection failed"));
        },
        { once: true },
      );
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.wantOpen) return;
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** this.reconnectAttempts,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wantOpen) return;
      void this.open().catch(() => {
        /* scheduleReconnect already re-armed inside open() on failure */
      });
    }, delay);
  }

  /** Close the socket and stop reconnecting. */
  close(): void {
    this.wantOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      try {
        socket.close();
      } finally {
        this.setState("closed");
        this.rejectAllPending(new Error("WebSocket closed"));
      }
    } else {
      this.setState("closed");
    }
  }

  /** Send a JSON-RPC request, resolving with `result` (or rejecting on error). */
  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = `c${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = {
        resolve: (v) => resolve(v as T),
        reject,
      };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new Error(`request timed out: ${method}`));
          }
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (err) {
        this.clearPending(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Subscribe to a specific server-push event type. Returns an unsubscribe fn. */
  onEvent(type: HermesEventType, cb: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  /** Subscribe to every event (raw log / debugging). Returns an unsubscribe fn. */
  onAnyEvent(cb: EventHandler): () => void {
    return this.onEvent(ANY as HermesEventType, cb);
  }

  /** Observe connection state. Fires immediately with the current state. */
  onState(cb: (s: WsConnectionState) => void): () => void {
    this.stateHandlers.add(cb);
    cb(this.state);
    return () => this.stateHandlers.delete(cb);
  }

  private handleMessage(raw: unknown): void {
    const text = typeof raw === "string" ? raw : String(raw);
    let frame: JsonRpcResponse & { method?: string; params?: HermesEvent };
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }

    if (frame.id !== undefined && frame.id !== null) {
      const call = this.pending.get(String(frame.id));
      if (!call) return;
      this.clearPending(String(frame.id));
      if (frame.error) {
        call.reject(new Error(frame.error.message || "Hermes RPC failed"));
      } else {
        call.resolve(frame.result);
      }
      return;
    }

    if (frame.method === "event" && frame.params?.type) {
      this.dispatchEvent(frame.params);
    }
  }

  private dispatchEvent(event: HermesEvent): void {
    for (const cb of this.handlers.get(event.type) ?? []) cb(event);
    for (const cb of this.handlers.get(ANY) ?? []) cb(event);
  }

  private clearPending(id: string): void {
    const call = this.pending.get(id);
    if (call?.timer) clearTimeout(call.timer);
    this.pending.delete(id);
  }

  private rejectAllPending(err: Error): void {
    for (const [id, call] of this.pending) {
      if (call.timer) clearTimeout(call.timer);
      call.reject(err);
      this.pending.delete(id);
    }
  }

  private setState(state: WsConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const cb of this.stateHandlers) cb(state);
  }
}

/** Shared singleton for app-wide use. */
export const hermesWs = new HermesWs();
