import { useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Timeline } from "../core/engine";
import { packetAppearance } from "../core/packets";
import type { Camera } from "./mapCamera";
import type { Point } from "./mapLayout";

export default function ResourceFlights({recording, time, host, dataTab, nodes, camera}: {
  recording: Timeline | null;
  time: number;
  host: RefObject<HTMLDivElement | null>;
  dataTab: RefObject<HTMLButtonElement | null>;
  nodes: Map<string, Point>;
  camera: Camera;
}) {
  const flights = useMemo(() => recording?.events.filter(event =>
    event.kind === "transfer" && (event.direction === "read" || event.direction === "write")) ?? [], [recording]);
  const visible = flights.filter(event => event.time <= time && time < (event.arrivesAt ?? event.time));
  if (!visible.length || !host.current || !dataTab.current) return null;

  const map = host.current.getBoundingClientRect();
  const anchor = (dataTab.current.querySelector("svg") ?? dataTab.current).getBoundingClientRect();
  const sky = {x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2};
  return createPortal(
    <svg className="resource-flights" aria-hidden="true">
      {visible.map(event => {
        const node = nodes.get(event.node);
        if (!node) return null;
        const ground = {
          x: map.left + camera.x + node.x * camera.scale,
          y: map.top + camera.y + node.y * camera.scale,
        };
        const progress = (time - event.time) / (event.arrivesAt! - event.time);
        const reading = event.direction === "read";
        const height = reading ? 1 - progress : progress;
        const lift = Math.min(82, Math.max(24, (ground.y - sky.y) * 0.28));
        const bend = Math.min(88, Math.max(36, Math.abs(ground.x - sky.x) * 0.36)) * (event.id % 2 ? 1 : -1);
        const at = (u: number) => {
          const arc = Math.sin(Math.PI * u);
          const slide = u * (2 - u);
          return {
            x: ground.x + (sky.x - ground.x) * slide + bend * arc * (1 - u),
            y: ground.y + (sky.y - ground.y) * u - lift * arc,
          };
        };
        const point = at(height);
        const tail = at(Math.min(1, Math.max(0, height + (reading ? 0.16 : -0.16))));
        const scale = Math.max(0.75, Math.min(1.3, camera.scale * 1.25)) * (1 - height) + 0.38 * height;
        const {color, symbol} = packetAppearance(event);
        return (
          <g key={event.id} data-direction={event.direction}>
            <ellipse cx={ground.x} cy={ground.y + 12} rx={15 * scale} ry={4 * scale}
              fill="#26392e" opacity={0.19 * (1 - height)} />
            <path d={`M${tail.x} ${tail.y} Q${tail.x} ${point.y} ${point.x} ${point.y}`}
              fill="none" stroke={color} strokeWidth={2.5 * scale} strokeLinecap="round" opacity={0.45} />
            <g transform={`translate(${point.x} ${point.y}) scale(${scale})`} fill={color} stroke="#fffdf7" strokeWidth="1">
              <path d="M-9 -9 L-3 -15 H15 L9 -9 Z" />
              <path d="M9 -9 L15 -15 V3 L9 9 Z" />
              <path d="M9 -9 L15 -15 V3 L9 9 Z" fill="#000" fillOpacity=".2" stroke="none" />
              <rect x="-9" y="-9" width="18" height="18" />
              <text y="1" dominantBaseline="central" textAnchor="middle" fill="white" stroke="#273f32"
                strokeWidth="1.4" paintOrder="stroke" fontSize="14">{symbol}</text>
            </g>
          </g>
        );
      })}
    </svg>,
    document.body,
  );
}
