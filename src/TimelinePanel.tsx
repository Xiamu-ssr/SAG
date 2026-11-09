import { useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, DownloadSimple, FilmStrip, Pause, Play, Rows } from "@phosphor-icons/react";
import type { Timeline } from "../core/engine";
import type { World } from "../core/model";
import { download, seconds, type Run } from "./api";
import { ErrorMessage } from "./components";

const minHeight = 96;
const maxHeight = 420;
const collapseHeight = 52;
const externalLane = {id: "service:", name: "外部服务", color: "#7886a3"};
type Playback = {
  run: Run;
  playing: boolean;
  onTime: (time: number) => void;
  onPlaying: (playing: boolean) => void;
};

export default function TimelinePanel({id, open, onCollapse, world, recording, time, playback, onSelect}: {
  id: string;
  open: boolean;
  onCollapse: () => void;
  world: World;
  recording: Timeline | null;
  time: number;
  playback?: Playback;
  onSelect: (node: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [preferredHeight, setHeight] = useState<number>();
  const height = preferredHeight ?? (playback ? 224 : 176);
  const drag = useRef<{y: number; visibleHeight: number; savedHeight?: number} | null>(null);
  const archived = playback?.run.recording;
  const duration = Math.max(1, archived?.duration ?? time);
  const progress = (value: number) => Math.max(0, Math.min(100, value / duration * 100));
  const lanes = world.services.length ? [...world.domains, externalLane] : world.domains;
  const tracks = useMemo(() => {
    const nodes = new Map(world.nodes.map(node => [node.id, node]));
    const services = new Map(world.services.map(service => [service.id, service]));
    const ends = new Map<number, number>();
    const byDomain = new Map(world.domains.map(domain => [domain.id, [] as {
      id: number; node: string; name: string; at: number; end?: number;
    }[]]));
    byDomain.set(externalLane.id, []);
    for (const event of recording?.events ?? []) {
      if (event.kind === "end" || event.kind === "cancel" || event.kind === "error")
        ends.set(event.invocation, event.time);
    }
    for (const event of recording?.events ?? []) {
      if (event.kind !== "enter") continue;
      const node = nodes.get(event.node);
      const target = node ?? services.get(event.node);
      if (target) byDomain.get(node?.domain ?? externalLane.id)?.push({
        id: event.id, node: target.id, name: target.name, at: event.time, end: ends.get(event.invocation),
      });
    }
    return byDomain;
  }, [recording, world]);

  function resize(requested: number) {
    const limit = Math.min(maxHeight, window.innerHeight * 0.48);
    setHeight(Math.round(Math.min(limit, Math.max(minHeight, requested))));
  }

  return (
    <section ref={panel} id={id} className="world-timeline" aria-label={playback ? "留影播放器" : "运行时间线"}
      hidden={!open} style={{height}}>
      {open && <>
        <div className="timeline-handle" role="separator" tabIndex={0}
          title="拖动调整时间线高度" aria-label="调整时间线高度" aria-orientation="horizontal"
          aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={height}
          onPointerDown={event => {
            if (event.button !== 0) return;
            drag.current = {y: event.clientY, visibleHeight: panel.current!.offsetHeight, savedHeight: preferredHeight};
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const start = drag.current;
            if (!start) return;
            const requested = start.visibleHeight + start.y - event.clientY;
            if (requested <= collapseHeight) {
              setHeight(start.savedHeight);
              drag.current = null;
              onCollapse();
            } else resize(requested);
          }}
          onLostPointerCapture={() => { drag.current = null; }}
          onKeyDown={event => {
            if (event.key === "Home") {
              event.preventDefault();
              onCollapse();
            } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const current = panel.current!.offsetHeight;
              resize(current + (event.key === "ArrowUp" ? 24 : -24));
            }
          }}
        ><span /></div>
        <div className="timeline-content">
          <div className="timeline-heading">
            {playback ? <FilmStrip size={19} /> : <Rows size={19} />}
            <strong>{playback ? "留影时间线" : "运行时间线"}</strong>
            {playback ? (
              <div className="timeline-actions">
                <button aria-label="导出留影" onClick={() =>
                  download("sag-recording-" + playback.run.id + ".json", JSON.stringify(playback.run, null, 2))}>
                  <DownloadSimple />
                </button>
              </div>
            ) : <time className="timeline-time">{seconds(time)}</time>}
          </div>
          {playback && <>
            <ErrorMessage message={archived?.error ?? ""} />
            <div className="transport">
              <button className="play-button" aria-label={playback.playing ? "暂停回放" : "播放留影"} onClick={() => {
                if (time >= duration) playback.onTime(0);
                playback.onPlaying(!playback.playing);
              }}>
                {playback.playing ? <Pause weight="fill" /> : <Play weight="fill" />}
              </button>
              <button aria-label="回到起点" onClick={() => {
                playback.onTime(0);
                playback.onPlaying(false);
              }}><ArrowCounterClockwise /></button>
              <div className="timeline-scrubber">
                <input aria-label="留影时间" type="range" min={0} max={duration} value={time}
                  onChange={event => {
                    playback.onTime(Number(event.target.value));
                    playback.onPlaying(false);
                  }} />
                <code>{seconds(time)} / {seconds(duration)}</code>
              </div>
            </div>
          </>}
          <div className="tracks">
            {lanes.map(domain => (
              <div className="track" key={domain.id}>
                <span><i style={{background: domain.color}} />{domain.name}</span>
                <div className="track-lane">
                  {tracks.get(domain.id)?.map(span => (
                    <button key={span.id} aria-label={`${span.name} ${seconds(span.at)}`}
                      title={`${span.name} · ${seconds(span.at)}`}
                      style={{
                        left: progress(span.at) + "%",
                        width: `max(3px, ${progress(span.end ?? Math.max(span.at, time)) - progress(span.at)}%)`,
                        background: domain.color,
                        opacity: span.at <= time ? 1 : 0.3,
                      }}
                      onClick={() => {
                        playback?.onTime(span.at);
                        playback?.onPlaying(false);
                        onSelect(span.node);
                      }} />
                  ))}
                  <i className="playhead" style={{left: progress(time) + "%"}} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </>}
    </section>
  );
}
