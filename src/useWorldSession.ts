import { useCallback, useEffect, useRef, useState } from "react";
import type { Start } from "../core/engine";
import type { SessionAction, SessionOptions, SessionSnapshot, SessionView } from "../server/session";
import { api } from "./api";

type LiveSession = SessionSnapshot & { view: SessionView; receivedAt: number };

export function useWorldSession(appId: string, onError: (error: string) => void) {
  const path = `/apps/${appId}/session`;
  const [session, setSession] = useState<LiveSession | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<LiveSession | null>(null);
  const command = useRef(false);
  const generation = useRef(0);

  const receive = useCallback((snapshot: SessionSnapshot | null) => {
    if (!snapshot) {
      current.current = null;
      setSession(null);
      return;
    }
    const previous = current.current;
    const view = snapshot.view ?? (snapshot.id === previous?.id ? previous.view : undefined);
    if (!view) return;
    const next = {...snapshot, view, receivedAt: performance.now()};
    current.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!command.current) {
        const stamp = generation.current;
        const since = current.current?.cursor;
        try {
          const snapshot = await api<SessionSnapshot | null>(path + (since ? "?since=" + encodeURIComponent(since) : ""));
          if (alive && stamp === generation.current) receive(snapshot);
        } catch (error) {
          if (alive && current.current) onError(String(error));
        }
      }
      const active = current.current;
      const delay = active?.status === "running"
        ? active.nextAt === undefined ? 250 : Math.max(40, 250 / Math.max(1, active.speed))
        : 1000;
      if (alive) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [path, receive, onError]);

  async function perform(endpoint: string, body: unknown) {
    if (command.current) throw new Error("世界正在处理操作");
    command.current = true;
    generation.current++;
    setBusy(true);
    try {
      const snapshot = await api<SessionSnapshot | null>(path + endpoint, "POST", body);
      receive(snapshot);
      return snapshot;
    } finally {
      command.current = false;
      setBusy(false);
    }
  }

  const lastActivity = useRef(-Infinity);
  const activity = useCallback(() => {
    const active = current.current;
    const now = performance.now();
    if (!active?.idleStop || now - lastActivity.current < 1000) return;
    lastActivity.current = now;
    void api(path + "/control", "POST", {sessionId: active.id, action: "activity"}).catch(() => {});
  }, [path]);
  useEffect(() => {
    if (!session?.idleStop) return;
    const types = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    const listener = (event: Event) => { if (event.isTrusted) activity(); };
    for (const type of types) window.addEventListener(type, listener, {passive: true});
    return () => { for (const type of types) window.removeEventListener(type, listener); };
  }, [session?.idleStop, activity]);

  return {
    session,
    busy,
    activity,
    start: (fingerprint: string, options: SessionOptions) => perform("", {fingerprint, ...options}),
    control: async (action: Exclude<SessionAction, "activity">) => {
      const active = current.current;
      if (active) await perform("/control", {sessionId: active.id, action, since: active.cursor});
    },
    setSessionSpeed: async (speed: number) => {
      const active = current.current;
      if (active && speed !== active.speed)
        await perform("/control", {sessionId: active.id, action: "speed", speed, since: active.cursor});
    },
    enter: async ({node, input}: Start) => {
      const active = current.current;
      if (active?.status !== "running") throw new Error("请先启动或继续世界");
      await perform("/input", {sessionId: active.id, node, input, since: active.cursor});
      return active.id;
    },
  };
}
