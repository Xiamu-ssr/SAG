import { lazy, Suspense, useEffect, useState } from "react";
import { api, type Space, type WorldSummary } from "./api";
import Home from "./Home";
import SessionReminder from "./SessionReminder";
import "./manual.css";
const WorldPage = lazy(() => import("./WorldPage"));
const Manual = lazy(() => import("./Manual"));
function worldId() {
  return location.hash.match(/^#\/world\/([a-zA-Z0-9-]+)$/)?.[1] || null;
}
export default function App() {
  const [hash, setHash] = useState(() => location.hash),
    [spaces, setSpaces] = useState<Space[]>([]),
    [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [chosenSpace, setChosenSpace] = useState("");
  const id = hash.match(/^#\/world\/([a-zA-Z0-9-]+)$/)?.[1] || null;
  const manual = hash === "#/manual" || hash === "#/manual/";
  async function refresh() {
    const nextSpaces = await api<Space[]>("/spaces");
    const nextWorlds = await api<WorldSummary[]>("/apps");
    setSpaces(nextSpaces);
    setWorlds(nextWorlds);
    const active = nextWorlds.find((world) => world.id === worldId());
    if (active) setChosenSpace(active.spaceId);
    setError("");
  }
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (manual) return;
    void refresh()
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, [id, manual]);
  const page = manual ? (
    <Suspense fallback={<div className="empty-state">正在读取说明书…</div>}>
      <Manual />
    </Suspense>
  ) : id ? (
    <Suspense fallback={<div className="empty-state">正在读取世界…</div>}>
      <WorldPage key={id} id={id} spaces={spaces} />
    </Suspense>
  ) : (
    <Home
      spaces={spaces}
      worlds={worlds}
      refresh={refresh}
      error={error}
      loading={loading}
      chosenSpace={chosenSpace}
      setChosenSpace={setChosenSpace}
    />
  );
  return <>{page}<SessionReminder /></>;
}
