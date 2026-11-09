import { useEffect, useRef, useState } from "react";
import { ArrowsOutSimple, Browser } from "@phosphor-icons/react";
import type { World } from "../core/model";
import type { Timeline, Start } from "../core/engine";
import { frontendInput, frontendOutputs } from "../core/frontend";
import { frontendUrl } from "./frontendDocument";
import type { Camera } from "./mapCamera";
import type { Point } from "./mapLayout";
import "./frontend.css";

export default function FrontendWindow({
  world,
  domain,
  assetBase,
  center,
  camera,
  width,
  height,
  recording,
  time,
  enabled,
  onActivity,
  onEntry,
  onError,
  onSelect,
  onResize,
}: {
  world: World;
  domain: World["domains"][number];
  assetBase: string;
  center: Point;
  camera: Camera;
  width: number;
  height: number;
  recording: Timeline | null;
  time: number;
  enabled: boolean;
  onEntry: (request: Start) => Promise<string>;
  onActivity?: () => void;
  onError: (message: string) => void;
  onSelect: () => void;
  onResize: (width: number, height: number) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const pending = useRef(false);
  const [draftSize, setDraftSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const current = useRef({
    world,
    domain,
    recording,
    time,
    enabled,
    onActivity,
    onEntry,
    onError,
  });
  current.current = {
    world,
    domain,
    recording,
    time,
    enabled,
    onActivity,
    onEntry,
    onError,
  };
  function send() {
    const c = current.current;
    frame.current?.contentWindow?.postMessage(
      {
        type: "sag:view",
        channel,
        enabled: c.enabled && !pending.current,
        trackActivity: !!c.onActivity,
        outputs: frontendOutputs(c.world, c.domain.id, c.recording, c.time),
      },
      "*",
    );
  }
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      if (event.data.type === "sag:ready") {
        send();
        return;
      }
      if (event.data.type === "sag:activity") {
        current.current.onActivity?.();
        return;
      }
      if (event.data.type !== "sag:input") return;
      const c = current.current;
      const target = frame.current!.contentWindow!;
      const requestId = event.data.requestId;
      void (async () => {
        let accepted = false;
        try {
          if (typeof requestId !== "string" || !requestId)
            throw new Error("前台请求缺少 requestId");
          if (!c.enabled || pending.current)
            throw new Error("请先启动或继续世界");
          const request = frontendInput(
            c.world,
            c.domain.id,
            event.data.node,
            event.data.input,
          );
          pending.current = true;
          accepted = true;
          send();
          const runId = await c.onEntry(request);
          target.postMessage(
            {
              type: "sag:result",
              channel,
              requestId,
              runId,
            },
            "*",
          );
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          target.postMessage(
            { type: "sag:error", channel, requestId, error },
            "*",
          );
          c.onError(error);
        } finally {
          if (accepted) {
            pending.current = false;
            send();
          }
        }
      })();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel]);
  useEffect(send, [world, recording, time, enabled, onActivity]);
  const shown = draftSize || { width, height };
  return (
    <section
      className="frontend-window"
      style={{
        width: shown.width,
        height: shown.height + 32,
        transform: `translate(${camera.x + (center.x - width / 2) * camera.scale}px,${camera.y + (center.y - height / 2 - 34) * camera.scale}px) scale(${camera.scale})`,
      }}
      aria-label={`${domain.name}窗口`}
    >
      <header>
        <button onClick={onSelect}>
          <Browser size={15} />
          {domain.name}
        </button>
        <span>
          {shown.width} × {shown.height}
        </span>
      </header>
      <iframe
        ref={frame}
        title={`${domain.name}交互界面`}
        sandbox="allow-scripts allow-forms"
        src={frontendUrl(assetBase, domain.id, channel)}
        onLoad={send}
      />
      <button
        className="frontend-resize"
        aria-label={`调整${domain.name}窗口尺寸`}
        title="拖动调整窗口尺寸"
        onPointerDown={(event) => {
          const start = { x: event.clientX, y: event.clientY };
          const button = event.currentTarget;
          button.setPointerCapture(event.pointerId);
          let latest = { width, height };
          const move = (e: PointerEvent) => {
            latest = {
              width: Math.max(
                240,
                Math.min(
                  800,
                  Math.round(width + (e.clientX - start.x) / camera.scale),
                ),
              ),
              height: Math.max(
                200,
                Math.min(
                  800,
                  Math.round(height + (e.clientY - start.y) / camera.scale),
                ),
              ),
            };
            setDraftSize(latest);
          };
          const up = () => {
            button.removeEventListener("pointermove", move);
            button.removeEventListener("pointerup", up);
            button.removeEventListener("pointercancel", up);
            setDraftSize(null);
            onResize(latest.width, latest.height);
          };
          button.addEventListener("pointermove", move);
          button.addEventListener("pointerup", up);
          button.addEventListener("pointercancel", up);
        }}
      >
        <ArrowsOutSimple size={12} />
      </button>
    </section>
  );
}
