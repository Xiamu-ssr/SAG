import { useEffect, useState } from "react";
import type { Reminder } from "../server/session";
import { api } from "./api";
import { ErrorMessage, Modal } from "./components";

export default function SessionReminder() {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{id: string; message: string} | null>(null);

  useEffect(() => {
    if (busy) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Reminder | null>("/sessions/reminder");
        if (alive) setReminder(next);
      } catch {}
      if (alive) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [busy]);

  if (!reminder) return null;

  async function respond(action: "stop" | "pause" | "continue") {
    if (!reminder || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/apps/${reminder.appId}/session/control`, "POST", {sessionId: reminder.sessionId, action});
      setReminder(null);
    } catch (cause) {
      setError({id: reminder.sessionId, message: String(cause)});
    } finally { setBusy(false); }
  }

  return (
    <Modal key={reminder.sessionId} title="世界仍在运行" className="session-dialog"
      onClose={() => void respond("continue")}>
      <div className="session-dialog-body">
        <p>要暂停或停止「{reminder.name}」吗？</p>
        <ErrorMessage message={error?.id === reminder.sessionId ? error.message : ""} />
        <footer>
          <button className="outline-button" disabled={busy} onClick={() => void respond("stop")}>停止</button>
          <button className="outline-button" disabled={busy} onClick={() => void respond("pause")}>暂停</button>
          <button className="primary" disabled={busy} onClick={() => void respond("continue")}>继续运行</button>
        </footer>
      </div>
    </Modal>
  );
}
