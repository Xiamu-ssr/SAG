import type { Event, Recording } from "./engine";

export const packetColors = [
  "#e45756",
  "#f58518",
  "#eeca3b",
  "#72b7b2",
  "#54a24b",
  "#4c78a8",
  "#b279a2",
  "#ff9da6",
  "#9d755d",
  "#bab0ac",
  "#d45087",
  "#ffa600",
  "#a05195",
  "#665191",
  "#2f4b7c",
  "#00876c",
  "#5ab4ac",
  "#d8b365",
  "#80cdc1",
  "#dfc27d",
  "#c51b7d",
  "#7fbc41",
  "#f46d43",
  "#3288bd",
  "#66c2a5",
  "#fc8d62",
  "#8da0cb",
  "#e78ac3",
  "#a6d854",
  "#ffd92f",
  "#e5c494",
  "#b3b3b3",
] as const;
export const packetSymbols = [
  "\u2648",
  "\u2649",
  "\u264a",
  "\u264b",
  "\u264c",
  "\u264d",
  "\u264e",
  "\u264f",
  "\u2650",
  "\u2651",
  "\u2652",
  "\u2653",
] as const;
type Packet = NonNullable<Event["packet"]>;

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

function skinAt(index: number): Packet["skin"] {
  return {
    symbol: packetSymbols[Math.floor(index / packetColors.length) % packetSymbols.length],
    color: packetColors[index % packetColors.length],
  };
}

export function packetDecorator(seed: string) {
  const streams = new Map<string, Packet>();
  const palette = Array.from(
    { length: packetColors.length * packetSymbols.length },
    (_, i) => i,
  );
  let random = hash(seed);
  for (let i = palette.length - 1; i > 0; i--) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const j = random % (i + 1);
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  let serial = 0;
  return (event: Event) => {
    if (event.kind !== "transfer") return;
    const streamId = event.packet?.streamId;
    const key = streamId
      ? JSON.stringify([streamId, event.node, event.target, event.invocation])
      : undefined;
    let packet = key === undefined ? undefined : streams.get(key);
    if (!packet) {
      // Exhaust the finite palette before reusing a skin; identities never wrap.
      packet = {
        id: `packet:${seed}:${serial}`,
        skin: skinAt(palette[serial % palette.length]),
      };
      serial++;
      if (key !== undefined) streams.set(key, packet);
    }
    event.packet = { ...event.packet, id: packet.id, skin: { ...packet.skin } };
  };
}

export function decoratePackets(recording: Recording, seed: string): Recording {
  const result = structuredClone(recording);
  result.events.forEach(packetDecorator(seed));
  return result;
}

export function packetAppearance(event: Event): {
  symbol: string;
  color: string;
  elongated: boolean;
  id: string;
} {
  if (event.packet)
    return {
      ...event.packet.skin,
      elongated: !!event.packet.streamId,
      id: event.packet.id,
    };
  const id = `event:${JSON.stringify([event.id, event.kind, event.node, event.target ?? null, event.invocation])}`;
  return {
    ...skinAt(hash(id) % (packetColors.length * packetSymbols.length)),
    elongated: false,
    id,
  };
}
