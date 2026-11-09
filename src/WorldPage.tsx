import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise, ArrowLeft, ArrowRight, BookOpen, Database, FileText, FilmStrip,
  GlobeHemisphereWest, Pause, Play, Plugs, Stop,
} from "@phosphor-icons/react";
import { parseWorld, type World } from "../core/model";
import { coordinateText } from "../core/coordinate";
import { stateAt } from "../core/engine";
import { worldRate } from "../core/speed";
import type { SessionAction, SessionOptions } from "../server/session";
import {
  api, date, type Run, type RunSummary, type Space, type WorldRow,
  type WorldSummary, type InitialData,
} from "./api";
import { Brand, ErrorMessage, Modal } from "./components";
import WorldMap from "./Map";
import SubjectDrawer from "./SubjectDrawer";
import ResourcesView from "./ResourcesView";
import TimelinePanel from "./TimelinePanel";
import SpeedControl from "./SpeedControl";
import { useWorldSession } from "./useWorldSession";
import DocumentsView from "./DocumentsView";

type View = "world" | "runs" | "fables" | "resources" | "services" | "documents";
const tabs = [
  { id: "world", name: "世界", icon: GlobeHemisphereWest },
  { id: "runs", name: "留影", icon: FilmStrip },
  { id: "fables", name: "寓言", icon: BookOpen },
  { id: "resources", name: "数据", icon: Database },
  { id: "services", name: "外部服务", icon: Plugs },
  { id: "documents", name: "文档", icon: FileText },
] as const;

export default function WorldPage({id, spaces}: {id: string; spaces: Space[]}) {
  const [app, setApp] = useState<WorldRow | null>(null);
  const [failedWorld, setFailedWorld] = useState<WorldSummary | null>(null);
  const [definition, setDefinition] = useState<World | null>(null);
  const [initial, setInitial] = useState<InitialData>({data: {}, fingerprint: ""});
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [replay, setReplay] = useState<{run: Run; world: World} | null>(null);
  const [view, setView] = useState<View>("world");
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [counts, setCounts] = useState(false);
  const [timelinePreference, setTimelinePreference] = useState<boolean>();
  const timelineId = useId();
  const dataTab = useRef<HTMLButtonElement>(null);
  const [liveTime, setLiveTime] = useState(0);
  const [replayTime, setReplayTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [startSpeed, setStartSpeed] = useState(1);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [launch, setLaunch] = useState(false);
  const [error, setError] = useState("");
  const {session, busy, activity, start, control, setSessionSpeed, enter} = useWorldSession(id, setError);
  const previousSession = useRef<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await api<WorldRow>("/apps/" + id);
      const world = parseWorld(loaded.source);
      const [history, data] = await Promise.all([
        api<RunSummary[]>(`/apps/${id}/runs`),
        api<InitialData>(`/apps/${id}/data`),
      ]);
      if (!alive) return;
      setApp(loaded);
      setDefinition(world);
      setRuns(history);
      setInitial(data);
    })().catch(async (cause) => {
      if (!alive) return;
      setError(String(cause));
      try {
        const summaries = await api<WorldSummary[]>("/apps");
        if (alive) setFailedWorld(summaries.find(item => item.id === id) || null);
      } catch {}
    });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (previousSession.current && !session)
      void api<RunSummary[]>(`/apps/${id}/runs`).then(setRuns).catch(cause => setError(String(cause)));
    previousSession.current = session?.id;
  }, [session?.id, id]);

  useEffect(() => {
    if (!session) return;
    setLiveTime(session.time);
    if (session.status !== "running" || session.nextAt === undefined || view !== "world" || replay)
      return;
    const next = session.nextAt;
    const rate = worldRate(session.speed);
    let frame = 0;
    const tick = (now: number) => {
      const time = Math.min(next, session.time + (now - session.receivedAt) * rate);
      setLiveTime(time);
      if (time < next) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session, view, replay]);

  useEffect(() => {
    if (!playing || !replay || view !== "world") return;
    let frame = 0;
    let last = performance.now();
    const duration = replay.run.recording.duration;
    const tick = (now: number) => {
      const elapsed = (now - last) * worldRate(speed);
      last = now;
      setReplayTime(time => Math.min(time + elapsed, duration));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, replay, speed, view]);
  useEffect(() => {
    if (view !== "world" || (replay && replayTime >= replay.run.recording.duration))
      setPlaying(false);
  }, [view, replayTime, replay]);

  const source = session?.view.source;
  const liveWorld = useMemo(
    () => source && source !== app?.source ? parseWorld(source) : definition,
    [source, app?.source, definition],
  );
  const world = replay?.world ?? liveWorld;
  const recording = replay?.run.recording ?? session?.view ?? null;
  const time = replay ? replayTime : session ? liveTime : 0;
  const timelineOpen = timelinePreference ?? Boolean(session || replay);
  const identity = app ?? failedWorld;

  async function startWorld(options: SessionOptions) {
    if (!app) return;
    setError("");
    try {
      await start(app.fingerprint, {...options, speed: startSpeed});
      setLaunch(false);
      setSelected(null);
      setView("world");
    } catch (cause) { setError(String(cause)); }
  }

  async function change(action: Exclude<SessionAction, "activity">) {
    setError("");
    try { await control(action); }
    catch (cause) { setError(String(cause)); }
  }

  async function adjustSpeed(value: number) {
    if (replay) {
      setSpeed(value);
      return;
    }
    setError("");
    try {
      if (session) await setSessionSpeed(value);
      setStartSpeed(value);
    } catch (cause) { setError(String(cause)); }
  }

  async function showRun(runId: string) {
    setLoadingReplay(true);
    setError("");
    setPlaying(false);
    try {
      const run = await api<Run>("/runs/" + runId);
      setReplay({run, world: parseWorld(run.source)});
      setReplayTime(0);
      setSpeed(session?.speed ?? startSpeed);
      setSelected(null);
      setTimelinePreference(true);
      setView("world");
    } catch (cause) {
      setError(String(cause));
    } finally { setLoadingReplay(false); }
  }

  return (
    <div className="world-page">
      <header className="world-header">
        <Brand />
        <a className="home-link" href="#/"><ArrowLeft />首页</a>
        <div className="world-identity">
          <span>{spaces.find(space => space.id === identity?.spaceId)?.name}</span>
          <h1>{identity?.name || "世界"}</h1>
        </div>
        <nav aria-label="世界导航">
          {tabs.map(({id: tab, name, icon: Icon}) => (
            <button key={tab} ref={tab === "resources" ? dataTab : undefined} className={view === tab ? "active" : ""}
              aria-current={view === tab ? "page" : undefined} onClick={() => {
                if (tab === "documents") setSelected(null);
                setView(tab);
              }}>
              <Icon size={18} />{name}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <SpeedControl speed={replay ? speed : session?.speed ?? startSpeed} onSpeed={adjustSpeed} />
          {replay ? (
            <button className="outline-button" onClick={() => {
              setReplay(null);
              setPlaying(false);
              setSelected(null);
              setView("world");
            }}><ArrowCounterClockwise />返回世界</button>
          ) : session ? (
            <>
              <button className="primary" disabled={busy}
                onClick={() => void change(session.status === "running" ? "pause" : "resume")}>
                {session.status === "running" ? <><Pause />暂停</> : <><Play />继续</>}
              </button>
              <button className="outline-button" disabled={busy} onClick={() => void change("stop")}>
                <Stop />停止
              </button>
            </>
          ) : (
            <button className="primary" disabled={!app || busy} onClick={() => {
              setError("");
              setLaunch(true);
            }}><Play weight="fill" />启动</button>
          )}
        </div>
      </header>
      {!launch && <ErrorMessage message={error || session?.error || ""} />}
      {!world && !error && <div className="empty-state">正在读取世界…</div>}
      {!world && error && (
        <div className="empty-state">
          <p>世界加载或校验失败</p>
          {identity?.directory && <code>{identity.directory}</code>}
        </div>
      )}
      {world && (
        <div className="world-workspace">
          <div className="world-main">
            {view === "world" && (
              <>
                <div className="world-body">
                  <WorldMap
                    world={world}
                    assetBase={replay?.run.assetBase ?? session?.view.assetBase ?? app?.assetBase ?? ""}
                    recording={recording}
                    time={time}
                    selected={selected}
                    highlighted={highlighted}
                    onSelect={item => {
                      setSelected(item);
                      setHighlighted(null);
                    }}
                    showFables={counts}
                    onToggleFables={() => setCounts(!counts)}
                    timelineId={timelineId}
                    timelineOpen={timelineOpen}
                    onToggleTimeline={() => setTimelinePreference(!timelineOpen)}
                    dataTab={dataTab}
                    frontendEnabled={!replay && session?.status === "running" && !busy}
                    onActivity={session?.idleStop ? activity : undefined}
                    onEntry={enter}
                    onError={setError}
                  />
                </div>
                <TimelinePanel id={timelineId} open={timelineOpen} onCollapse={() => setTimelinePreference(false)}
                  world={world} recording={recording} time={time} onSelect={setSelected}
                  playback={replay ? {
                    run: replay.run, playing, onTime: setReplayTime, onPlaying: setPlaying,
                  } : undefined} />
              </>
            )}
            {view === "runs" && (
              <main className="detail-content">
                <h2>留影</h2>
                {!runs.length && <div className="empty-state"><FilmStrip size={38} /><p>还没有保存的留影</p></div>}
                {runs.map(item => (
                  <button className="record-card" disabled={loadingReplay} key={item.id} onClick={() => void showRun(item.id)}>
                    <FilmStrip size={25} />
                    <div>
                      <h3>{item.name || definition?.nodes.find(node => node.id === item.entry)?.name || item.entry}</h3>
                      <p>{date(item.created)}</p>
                    </div>
                    <span className={item.status === "failed" ? "status failed" : "status"}>
                      {item.status === "failed" ? "失败" : "留影"}
                    </span>
                    <Play />
                  </button>
                ))}
              </main>
            )}
            {view === "fables" && (
              <main className="detail-content">
                <h2>寓言</h2>
                {!world.fables.length && <div className="empty-state"><BookOpen size={38} /><p>还没有寓言</p></div>}
                {world.fables.map((fable, i) => {
                  const owner = fable.type === "packet" || fable.type === "output"
                    ? fable.target.split("/").slice(0, 2).join("/") : fable.target;
                  return (
                    <article className="fable-card" key={i}>
                      <div className="fable-heading"><BookOpen size={21} /><h3>{fable.text}</h3></div>
                      <div className="targets">
                        <button onClick={() => setSelected(owner)}>
                          <span>{coordinateText(fable.target, fable.type)}</span><ArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </main>
            )}
            {view === "resources" && (
              <ResourcesView
                key={replay?.run.id ?? session?.id ?? "initial"}
                world={world}
                initial={replay ? replay.run.recording.initial : session?.view.initial ?? initial.data}
                current={replay ? stateAt(replay.run.recording, time) : session?.view.current ?? null}
                time={time}
              />
            )}
            {view === "services" && (
              <main className="detail-content">
                <h2>外部服务</h2>
                {!world.services.length && <div className="empty-state"><Plugs size={38} /><p>还没有声明外部服务</p></div>}
                {world.services.map(service => (
                  <button className="record-card" key={service.id} onClick={() => setSelected(service.id)}>
                    <Plugs size={23} />
                    <div>
                      <h3>{service.name}</h3>
                      <p>{service.description || service.script}</p>
                    </div>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </main>
            )}
            {view === "documents" && <DocumentsView key={id} worldId={id} />}
          </div>
          {selected && (
            <SubjectDrawer key={selected} world={world} selected={selected} recording={recording} time={time}
              onHighlight={item => {
                if (world.services.some(service => service.id === item)) {
                  setSelected(item);
                  setView("services");
                  return;
                }
                if (world.resources.some(resource => resource.id === item)) {
                  setSelected(null);
                  setView("resources");
                  return;
                }
                setHighlighted(item);
                setView("world");
              }}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
      {launch && !session && (
        <Modal title="启动世界" className="session-dialog" onClose={() => { if (!busy) setLaunch(false); }}>
          <form onSubmit={event => {
            event.preventDefault();
            const options = new FormData(event.currentTarget);
            void startWorld({record: options.has("record"), idleStop: options.has("idleStop")});
          }}>
            <label><input type="checkbox" name="record" />保存留影</label>
            <label><input type="checkbox" name="idleStop" />空闲 30 分钟自动停止</label>
            <ErrorMessage message={error} />
            <footer><button className="primary" disabled={busy}>启动</button></footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
