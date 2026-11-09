import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Application,
  Container,
  Graphics,
  Text,
  Sprite,
  Assets,
  Polygon,
  type FederatedPointerEvent,
} from "pixi.js";
import { Minus, Plus, CornersOut, BookOpen, Rows } from "@phosphor-icons/react";
import { roadsFor, fablesFor } from "../core/topology";
import type { World } from "../core/model";
import type { Timeline, Start } from "../core/engine";
import { packetAppearance } from "../core/packets";
import { zoomAt, type Camera } from "./mapCamera";
import { createPacketVisual } from "./packetVisual";
import { mapLayout, type ViewSizes } from "./mapLayout";
import FrontendWindow from "./FrontendWindow";
import ResourceFlights from "./ResourceFlights";

type Point = { x: number; y: number };
type Scene = {
  app: Application;
  stage: Container;
  overlay: Container;
  nodes: Map<string, Point>;
  centers: Map<string, Point>;
  draw: () => void;
  fit: () => void;
  setCamera: (value: Camera) => void;
};
export default function WorldMap({
  world,
  assetBase,
  recording,
  time,
  selected,
  highlighted,
  onSelect,
  showFables,
  onToggleFables,
  timelineId,
  timelineOpen,
  onToggleTimeline,
  dataTab,
  frontendEnabled = false,
  onActivity,
  onEntry,
  onError = () => {},
}: {
  world: World;
  assetBase: string;
  recording: Timeline | null;
  time: number;
  selected: string | null;
  highlighted?: string | null;
  onSelect: (id: string) => void;
  showFables: boolean;
  onToggleFables: () => void;
  timelineId: string;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  dataTab: RefObject<HTMLButtonElement | null>;
  frontendEnabled?: boolean;
  onEntry: (request: Start) => Promise<string>;
  onActivity?: () => void;
  onError?: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const camera = useRef<(Camera & { worldId: string; fitted: boolean }) | null>(null);
  const current = useRef({
    recording,
    time,
    selected,
    highlighted,
    onSelect,
    showFables,
  });
  current.current = {
    recording,
    time,
    selected,
    highlighted,
    onSelect,
    showFables,
  };
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [viewCamera, setViewCamera] = useState<Camera>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [sizes, setSizes] = useState<ViewSizes>({});
  const layout = useMemo(() => mapLayout(world, sizes), [world, sizes]);
  useEffect(() => {
    let dead = false,
      destroyed = false,
      observer: ResizeObserver | undefined;
    let removeWheel: (() => void) | undefined;
    const app = new Application();
    function dispose() {
      if (!destroyed && app.renderer) {
        destroyed = true;
        app.destroy(true, { children: true });
      }
    }
    const element = host.current!;
    setError("");
    async function start() {
      await app.init({
        resizeTo: element,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(devicePixelRatio, 2),
        autoDensity: true,
        preference: "webgl",
      });
      if (dead) {
        dispose();
        return;
      }
      element.appendChild(app.canvas);
      app.canvas.setAttribute("aria-hidden", "true");
      const stage = new Container();
      app.stage.addChild(stage);
      const layer = (name: string) => {
        const c = new Container();
        c.label = name;
        stage.addChild(c);
        return c;
      };
      const ground = layer("ground"),
        paths = layer("inter-domain-roads"),
        externalPackets = layer("inter-domain-packets"),
        terrain = layer("domains"),
        localPaths = layer("local-roads"),
        localPackets = layer("local-packets"),
        hubs = layer("domain-centers"),
        nodeLayer = layer("nodes"),
        labels = layer("labels");
      element.dataset.layers =
        "ground,inter-domain-roads,inter-domain-packets,domains,local-roads,local-packets,domain-centers,nodes,labels";
      let down = false,
        moved = false;
      let previous: Point = { x: 0, y: 0 },
        origin: Point = { x: 0, y: 0 };
      const pick = (id: string) => () => {
        if (!moved) current.current.onSelect(id);
      };
      const {
        centers,
        nodes,
        bounds,
        width: w,
        height: h,
      } = layout;
      const grid = new Graphics();
      for (let x = -1000; x < w + 1000; x += 36)
        for (let y = -1000; y < h + 1000; y += 36)
          grid.circle(x, y, 0.65).fill({ color: 0x899487, alpha: 0.22 });
      ground.addChild(grid);
      const roads = roadsFor(world);
      for (const road of roads) {
        const a = centers.get(road.from)!,
          z = centers.get(road.to)!;
        const path = new Graphics();
        path
          .moveTo(a.x, a.y)
          .lineTo(z.x, z.y)
          .stroke({ width: 12, color: 0xd5d2c5 });
        path
          .moveTo(a.x, a.y)
          .lineTo(z.x, z.y)
          .stroke({ width: 8, color: 0xfaf9f4 });
        const length = Math.hypot(z.x - a.x, z.y - a.y),
          nx = (-(z.y - a.y) / length) * 12,
          ny = ((z.x - a.x) / length) * 12;
        path.hitArea = new Polygon([
          a.x + nx,
          a.y + ny,
          z.x + nx,
          z.y + ny,
          z.x - nx,
          z.y - ny,
          a.x - nx,
          a.y - ny,
        ]);
        path.eventMode = "static";
        path.cursor = "pointer";
        path.on("pointertap", pick(road.id));
        paths.addChild(path);
      }
      let hubTexture;
      try {
        hubTexture = await Assets.load("/assets/domain-hub.png");
      } catch {
        /* A missing optional illustration must not hide the graph. */
      }
      if (dead) {
        dispose();
        return;
      }
      const text = (
        s: string,
        x: number,
        y: number,
        size = 13,
        color = "#35473e",
        weight: "normal" | "600" = "normal",
      ) => {
        const t = new Text({
          text: s,
          style: {
            fontFamily: "Manrope Variable, PingFang SC, sans-serif",
            fontSize: size,
            fill: color,
            fontWeight: weight,
          },
        });
        t.anchor.set(0.5);
        t.position.set(x, y);
        labels.addChild(t);
        return t;
      };
      for (const d of world.domains) {
        const p = centers.get(d.id)!;
        const box = bounds.get(d.id)!;
        const left = p.x - box.width / 2,
          top = p.y - box.height / 2;
        const radius = d.type === "UI" ? 36 : 85;
        const color = parseInt(d.color.slice(1), 16);
        const land = new Graphics();
        land
          .roundRect(left, top + 13, box.width, box.height, radius)
          .fill({ color: 0xa5ab98, alpha: 0.18 });
        land
          .roundRect(left, top + 6, box.width, box.height, radius)
          .fill({ color: 0xdedecf });
        land
          .roundRect(left, top, box.width, box.height, radius)
          .fill({ color: 0xf9f8f1 })
          .stroke({ color, width: 1, alpha: 0.25 });
        land
          .roundRect(
            left + 8,
            top + 8,
            box.width - 16,
            box.height - 16,
            radius - 6,
          )
          .fill({ color, alpha: 0.075 })
          .stroke({ color, width: 1, alpha: 0.15 });
        land
          .roundRect(
            left + 17,
            top + 17,
            box.width - 34,
            box.height - 34,
            radius - 15,
          )
          .stroke({ color, width: 1, alpha: 0.08 });
        terrain.addChild(land);
        land.eventMode = "static";
        land.cursor = "pointer";
        land.on("pointertap", pick(d.id));
        for (const n of world.nodes.filter((n) => n.domain === d.id)) {
          const q = nodes.get(n.id)!;
          const route = new Graphics();
          route
            .moveTo(p.x, p.y)
            .lineTo(q.x, q.y)
            .stroke({ width: 5, color: 0xffffff, alpha: 0.85 });
          route
            .moveTo(p.x, p.y)
            .lineTo(q.x, q.y)
            .stroke({ width: 1, color, alpha: 0.27 });
          localPaths.addChild(route);
        }
        if (d.type === "UI" && d.view) continue;
        if (hubTexture) {
          const hub = new Sprite(hubTexture);
          hub.anchor.set(0.5);
          hub.position.set(p.x, p.y - 6);
          hub.width = 112;
          hub.height = 112;
          hubs.addChild(hub);
          hub.eventMode = "static";
          hub.cursor = "pointer";
          hub.on("pointertap", pick(d.id));
        } else {
          const plinth = new Graphics()
            .ellipse(p.x, p.y, 30, 16)
            .fill({ color, alpha: 0.18 })
            .stroke({ color, width: 1 });
          hubs.addChild(plinth);
        }
        const domainLabel = text(d.name, p.x, p.y + 50, 18, d.color, "600");
        domainLabel.eventMode = "static";
        domainLabel.cursor = "pointer";
        domainLabel.on("pointertap", pick(d.id));
      }
      for (const n of world.nodes) {
        const p = nodes.get(n.id)!;
        const d = world.domains.find((d) => d.id === n.domain)!;
        const node = new Graphics()
          .roundRect(p.x - 70, p.y - 21 + 5, 140, 42, 10)
          .fill({ color: 0x465446, alpha: 0.12 })
          .roundRect(p.x - 70, p.y - 21, 140, 42, 10)
          .fill({ color: 0xfffffc })
          .stroke({
            color: parseInt(d.color.slice(1), 16),
            alpha: 0.32,
            width: 1,
          });
        node.eventMode = "static";
        node.cursor = "pointer";
        node.on("pointertap", pick(n.id));
        nodeLayer.addChild(node);
        text(n.name, p.x + 9, p.y - 1, 12, "#2e4238", "600").eventMode = "none";
        const icon = new Graphics(),
          ix = p.x - 52,
          iy = p.y,
          stroke = { color: parseInt(d.color.slice(1), 16), width: 1.5 };
        icon
          .moveTo(ix - 5, iy - 7)
          .lineTo(ix - 5, iy + 7)
          .moveTo(ix - 5, iy + 1)
          .lineTo(ix + 5, iy - 4)
          .stroke(stroke)
          .circle(ix - 5, iy - 8, 2)
          .circle(ix - 5, iy + 8, 2)
          .circle(ix + 6, iy - 5, 2)
          .stroke(stroke);
        icon.eventMode = "none";
        nodeLayer.addChild(icon);
      }
      const overlay = new Container();
      overlay.eventMode = "none";
      stage.addChild(overlay);
      const badges = new Container();
      badges.eventMode = "none";
      stage.addChild(badges);
      function badge(id: string, x: number, y: number) {
        const backing = new Graphics()
          .roundRect(x - 11, y - 9, 22, 18, 6)
          .fill(0x526a48)
          .stroke({ color: 0xfffff5, width: 1 });
        const label = new Text({
          text: String(fablesFor(world, id).length),
          style: {
            fontFamily: "Manrope Variable",
            fontSize: 11,
            fill: 0xffffff,
            fontWeight: "600",
          },
        });
        label.anchor.set(0.5);
        label.position.set(x, y);
        badges.addChild(backing, label);
      }
      for (const d of world.domains) {
        const p = centers.get(d.id)!;
        const box = bounds.get(d.id)!;
        badge(d.id, p.x + box.width / 2 - 24, p.y - box.height / 2 + 24);
      }
      for (const n of world.nodes) {
        const p = nodes.get(n.id)!;
        badge(n.id, p.x + 66, p.y - 22);
      }
      for (const r of roads) {
        const a = centers.get(r.from)!,
          z = centers.get(r.to)!;
        badge(r.id, (a.x + z.x) / 2, (a.y + z.y) / 2);
      }
      function setCamera(value: Camera, fitted = false) {
        stage.scale.set(value.scale);
        stage.position.set(value.x, value.y);
        camera.current = { ...value, worldId: world.name, fitted };
        element.dataset.camera = JSON.stringify(value);
        setViewCamera(value);
        setZoom(Math.round(value.scale * 100));
      }
      function fit() {
        const s = Math.min(app.screen.width / w, app.screen.height / h) * 0.93;
        setCamera({
          scale: s,
          x: (app.screen.width - w * s) / 2,
          y: (app.screen.height - h * s) / 2,
        }, true);
      }
      let packetRecording: Timeline | null | undefined;
      const packetViews = new Map<number, Container>();
      function draw() {
        for (const child of overlay.removeChildren()) child.destroy();
        const {
          recording: r,
          time: now,
          selected: picked,
          highlighted: targetHighlight,
          showFables: counts,
        } = current.current;
        badges.visible = counts;
        const g = new Graphics();
        overlay.addChild(g);
        const entered = new Set<string>();
        const active = new Map<number, string>();
        for (const event of r?.events ?? []) {
          if (event.time > now) break;
          if (event.kind === "enter") {
            entered.add(event.node);
            active.set(event.invocation, event.node);
          }
          if (event.kind === "end" || event.kind === "cancel" || event.kind === "error")
            active.delete(event.invocation);
        }
        const activeNodes = new Set(active.values());
        for (const n of world.nodes) {
          const p = nodes.get(n.id)!;
          const d = world.domains.find((d) => d.id === n.domain)!;
          const color = parseInt(d.color.slice(1), 16);
          const running = activeNodes.has(n.id);
          if (entered.has(n.id)) g.circle(p.x + 61, p.y + 13, 3).fill(color);
          if (running || picked === n.id || targetHighlight === n.id)
            g.roundRect(p.x - 74, p.y - 25, 148, 50, 13).stroke({
              color,
              width: running || targetHighlight === n.id ? 3 : 1.5,
              alpha: 0.85,
            });
        }
        for (const d of world.domains) {
          const p = centers.get(d.id)!;
          const box = bounds.get(d.id)!;
          if (picked === d.id)
            g.roundRect(
              p.x - box.width / 2,
              p.y - box.height / 2,
              box.width,
              box.height,
              d.type === "UI" ? 36 : 85,
            ).stroke({
              color: parseInt(d.color.slice(1), 16),
              width: 2,
              alpha: 0.6,
            });
        }
        for (const road of roads) {
          const a = centers.get(road.from)!,
            z = centers.get(road.to)!,
            mx = (a.x + z.x) / 2,
            my = (a.y + z.y) / 2;
          if (picked === road.id)
            g.circle(mx, my, 8).fill({ color: 0x6c885e, alpha: 0.45 });
        }
        if (packetRecording !== r) {
          for (const v of packetViews.values()) {
            v.removeFromParent();
            v.destroy({ children: true });
          }
          packetViews.clear();
          packetRecording = r;
        }
        for (const packet of packetViews.values()) packet.visible = false;
        for (const e of r?.events || []) {
          if (e.time > now) break;
          if (
            e.kind !== "transfer" ||
            !e.target ||
            e.arrivesAt === undefined ||
            now > e.arrivesAt
          )
            continue;
          const from = world.nodes.find((n) => n.id === e.node),
            to = world.nodes.find((n) => n.id === e.target);
          if (!from || !to) continue;
          let packet = packetViews.get(e.id);
          if (!packet) {
            packet = createPacketVisual(packetAppearance(e));
            packetViews.set(e.id, packet);
          }
          const a = nodes.get(e.node)!,
            b = nodes.get(e.target)!;
          const points =
            from.domain === to.domain
              ? [a, centers.get(from.domain)!, b]
              : [a, centers.get(from.domain)!, centers.get(to.domain)!, b];
          const fraction = ((now - e.time) / (e.arrivesAt - e.time)) * (points.length - 1),
            i = Math.min(Math.floor(fraction), points.length - 2),
            t = fraction - i;
          const x = points[i].x + (points[i + 1].x - points[i].x) * t,
            y = points[i].y + (points[i + 1].y - points[i].y) * t;
          const targetLayer =
            from.domain !== to.domain && i === 1
              ? externalPackets
              : localPackets;
          if (packet.parent !== targetLayer) targetLayer.addChild(packet);
          packet.position.set(x, y);
          packet.visible = true;
        }
      }
      scene.current = {
        app,
        stage,
        overlay,
        centers,
        nodes,
        draw,
        fit,
        setCamera,
      };
      if (camera.current?.worldId === world.name && !camera.current.fitted) setCamera(camera.current);
      else fit();
      draw();
      let viewport = { width: app.screen.width, height: app.screen.height };
      observer = new ResizeObserver(() => {
        app.resize();
        app.stage.hitArea = app.screen;
        const { width, height } = app.screen;
        if (width !== viewport.width || height !== viewport.height) {
          if (camera.current?.fitted) fit();
          else setCamera({
            x: stage.x + (width - viewport.width) / 2,
            y: stage.y + (height - viewport.height) / 2,
            scale: stage.scale.x,
          });
          viewport = { width, height };
        }
      });
      observer.observe(element);
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
        if (e.button !== 0) return;
        down = true;
        moved = false;
        previous = { x: e.global.x, y: e.global.y };
        origin = { ...previous };
      });
      app.stage.on("globalpointermove", (e: FederatedPointerEvent) => {
        if (!down) return;
        if (Math.hypot(e.global.x - origin.x, e.global.y - origin.y) > 5)
          moved = true;
        if (!moved) return;
        setCamera({
          x: stage.x + e.global.x - previous.x,
          y: stage.y + e.global.y - previous.y,
          scale: stage.scale.x,
        });
        previous = { x: e.global.x, y: e.global.y };
      });
      app.stage.on("pointerup", () => (down = false));
      app.stage.on("pointerupoutside", () => (down = false));
      app.stage.on("pointercancel", () => {
        down = false;
      });
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        const bounds = element.getBoundingClientRect();
        const delta =
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? bounds.height
              : 1);
        setCamera(
          zoomAt(
            { x: stage.x, y: stage.y, scale: stage.scale.x },
            Math.exp(-Math.max(-600, Math.min(600, delta)) * 0.0018),
            { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          ),
        );
      };
      element.addEventListener("wheel", wheel, { passive: false });
      removeWheel = () => element.removeEventListener("wheel", wheel);
    }
    void start().catch((e) => {
      if (!dead) setError(String(e));
    });
    return () => {
      dead = true;
      observer?.disconnect();
      removeWheel?.();
      scene.current = null;
      dispose();
    };
  }, [world, sizes]);
  useEffect(() => {
    scene.current?.draw();
  }, [recording, time, selected, highlighted, showFables]);
  function scale(factor: number) {
    const s = scene.current;
    if (!s) return;
    s.setCamera(
      zoomAt({ x: s.stage.x, y: s.stage.y, scale: s.stage.scale.x }, factor, {
        x: s.app.screen.width / 2,
        y: s.app.screen.height / 2,
      }),
    );
  }
  return (
    <div className="map-wrap">
      <div
        ref={host}
        className="pixi-host"
        role="img"
        aria-label={`${world.name}，${world.domains.length} 个大域，${world.nodes.length} 个小域`}
      />
      <div className="frontend-layer">
        {world.domains
          .filter((d) => d.type === "UI" && d.view)
          .map((d) => {
            const size = sizes[d.id] || d.view!;
            return (
              <FrontendWindow
                key={`${assetBase}/${d.id}`}
                world={world}
                domain={d}
                assetBase={assetBase}
                center={layout.centers.get(d.id)!}
                camera={viewCamera}
                width={size.width}
                height={size.height}
                recording={recording}
                time={time}
                enabled={frontendEnabled}
                onActivity={onActivity}
                onEntry={onEntry}
                onError={onError}
                onSelect={() => onSelect(d.id)}
                onResize={(width, height) =>
                  setSizes((previous) => ({
                    ...previous,
                    [d.id]: { width, height },
                  }))
                }
              />
            );
          })}
      </div>
      <div className="map-tools">
        <button
          title={showFables ? "隐藏寓言数量" : "显示寓言数量"}
          aria-label={showFables ? "隐藏寓言数量" : "显示寓言数量"}
          aria-pressed={showFables}
          onClick={onToggleFables}
        >
          <BookOpen />
        </button>
        <button
          title={timelineOpen ? "收起时间线" : "展开时间线"}
          aria-label={timelineOpen ? "收起时间线" : "展开时间线"}
          aria-expanded={timelineOpen}
          aria-controls={timelineId}
          onClick={onToggleTimeline}
        >
          <Rows />
        </button>
      </div>
      <ResourceFlights recording={recording} time={time} host={host} dataTab={dataTab}
        nodes={layout.nodes} camera={viewCamera} />
      <div className="map-accessible" aria-label="地图主体">
        {[
          ...world.domains,
          ...world.nodes,
          ...roadsFor(world).map((r) => ({
            id: r.id,
            name: `${world.domains.find((d) => d.id === r.from)?.name}与${world.domains.find((d) => d.id === r.to)?.name}之间的道路`,
          })),
        ].map((subject) => (
          <button key={subject.id} onClick={() => onSelect(subject.id)}>
            {subject.name}
            {showFables
              ? ` · ${fablesFor(world, subject.id).length} 条寓言`
              : ""}
          </button>
        ))}
      </div>
      {error && (
        <div className="map-error">
          画布暂不可用<small>{error}</small>
        </div>
      )}
      <div className="map-controls">
        <button aria-label="缩小" onClick={() => scale(0.85)}>
          <Minus />
        </button>
        <span>{zoom}%</span>
        <button aria-label="放大" onClick={() => scale(1.18)}>
          <Plus />
        </button>
        <button aria-label="适应画布" onClick={() => scene.current?.fit()}>
          <CornersOut />
        </button>
      </div>
    </div>
  );
}
