import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, stateAt, type Event, type Recording } from "../core/engine";
import { parseWorld } from "../core/model";
import { decoratePackets, packetAppearance } from "../core/packets";
import { callSource, normalStart, draft, sourceOf } from "./fixtures";

const definition = draft(callSource);
definition.domain.业务.node.另读 = structuredClone(
  definition.domain.业务.node.朗读,
);
definition.domain.手表.node.提交.output.发送.action.push('go([业务:domain/另读:node], output)');
const original = simulate(parseWorld(sourceOf(definition)), normalStart);

function transfer(overrides: Partial<Event> = {}): Event {
  return {
    ...structuredClone(original.events.find((e) => e.kind === "transfer")!),
    ...overrides,
  };
}

function withEvents(events: Event[]): Recording {
  return { ...structuredClone(original), events };
}

function withoutPackets(recording: Recording): Recording {
  const result = structuredClone(recording);
  for (const event of result.events) delete event.packet;
  return result;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test("packet decoration is seeded, repeatable and changes no business state or event data", () => {
  const input = freeze(structuredClone(original)),
    before = JSON.stringify(input);
  const decorated = decoratePackets(input, "first-run");
  assert.deepEqual(decoratePackets(input, "first-run"), decorated);
  assert.deepEqual(decoratePackets(decorated, "first-run"), decorated);
  assert.deepEqual(withoutPackets(decorated), input);
  assert.equal(JSON.stringify(input), before);
  assert(!input.events.some((e) => e.packet));
  for (let i = 0; i < input.events.length; i++) {
    const event = decorated.events[i];
    assert.equal(!!event.packet, event.kind === "transfer");
    assert.notEqual(event.data, input.events[i].data);
  }
  assert.deepEqual(
    stateAt(decorated, decorated.duration),
    stateAt(input, input.duration),
  );
  const worlds = ["second-run", "third-run", "fourth-run"].map((seed) =>
    decoratePackets(input, seed),
  );
  let previous = decorated;
  for (const next of worlds) {
    const packets = (recording: Recording) =>
      recording.events
        .filter((e) => e.kind === "transfer")
        .map((e) => e.packet!);
    assert.notDeepEqual(
      packets(next).map((p) => p.id),
      packets(previous).map((p) => p.id),
    );
    assert.notDeepEqual(
      packets(next).map((p) => p.skin),
      packets(previous).map((p) => p.skin),
    );
    assert.deepEqual(withoutPackets(next), input);
    previous = next;
  }
});

test("the fixed palette contains exactly 32 colors and 12 zodiac symbols with independent identities", () => {
  const input = withEvents(
    Array.from({ length: 385 }, (_, i) => transfer({ id: i + 1 })),
  );
  const events = decoratePackets(input, "palette").events;
  const skins = events.slice(0, 384).map((e) => e.packet!.skin);
  assert.equal(new Set(skins.map((s) => s.color)).size, 32);
  assert.equal(new Set(skins.map((s) => s.symbol)).size, 12);
  assert.equal(new Set(skins.map((s) => JSON.stringify(s))).size, 384);
  for (const skin of skins) {
    assert.match(skin.color, /^#[0-9a-f]{6}$/);
    assert.match(skin.symbol, /^[\u2648-\u2653]$/u);
  }
  assert.deepEqual(events[384].packet!.skin, events[0].packet!.skin);
  assert.equal(new Set(events.map((e) => e.packet!.id)).size, events.length);
});

test("broadcasts are separate logical packets even with the same invocation and payload", () => {
  const events = decoratePackets(original, "broadcast").events.filter(
    (e) => e.kind === "transfer" && e.node === "手表/提交",
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].invocation, events[1].invocation);
  assert.equal(events[0].branch, events[1].branch);
  assert.deepEqual(events[0].data, events[1].data);
  assert.notEqual(events[0].target, events[1].target);
  assert.notEqual(events[0].packet!.id, events[1].packet!.id);
  assert.notDeepEqual(events[0].packet!.skin, events[1].packet!.skin);
  assert(events.every((e) => !packetAppearance(e).elongated));
});

test("repeated endpoints, invocations, arrays and segment numbers never implicitly create a stream", () => {
  const events = decoratePackets(
    withEvents([
      transfer({ id: 1, invocation: 1, data: { chunks: ["one", "two"] } }),
      transfer({ id: 2, invocation: 1, data: { chunks: ["one", "two"] } }),
      transfer({ id: 3, invocation: 2, data: { chunks: ["one", "two"] } }),
      transfer({
        id: 4,
        invocation: 2,
        data: { chunks: ["one", "two"] },
        packet: {
          id: "unassigned",
          skin: { symbol: "", color: "" },
          segment: 1,
        },
      }),
    ]),
    "repeated",
  ).events;
  assert.equal(new Set(events.map((e) => e.packet!.id)).size, 4);
  assert.equal(
    new Set(events.map((e) => JSON.stringify(e.packet!.skin))).size,
    4,
  );
  assert(events.every((e) => !packetAppearance(e).elongated));
});

test("only explicit streams with the same source, target and invocation share their elongated appearance", () => {
  const segment = (id: number, overrides: Partial<Event> = {}) =>
    transfer({
      id,
      node: "demo/source",
      target: "demo/target",
      invocation: 1,
      packet: {
        id: "unassigned",
        skin: { symbol: "", color: "" },
        streamId: "stream",
        segment: id - 1,
      },
      ...overrides,
    });
  const input = freeze(
    withEvents([
      segment(1),
      segment(2, { target: "demo/other" }),
      segment(3),
      segment(4, { node: "demo/other" }),
      segment(5, { invocation: 2 }),
      segment(6, {
        packet: {
          id: "unassigned",
          skin: { symbol: "", color: "" },
          streamId: "another-stream",
          segment: 0,
        },
      }),
    ]),
  );
  const decorated = decoratePackets(input, "streamed"),
    events = decorated.events;
  assert.deepEqual(packetAppearance(events[0]), packetAppearance(events[2]));
  assert.notEqual(events[0].packet!.skin, events[2].packet!.skin);
  assert.equal(new Set(events.map((e) => e.packet!.id)).size, 5);
  assert.equal(
    new Set(events.map((e) => JSON.stringify(e.packet!.skin))).size,
    5,
  );
  assert(events.every((e) => packetAppearance(e).elongated));
  assert.deepEqual(
    events.map((e) => e.packet!.segment),
    input.events.map((e) => e.packet!.segment),
  );
  assert.deepEqual(
    events.map((e) => e.packet!.streamId),
    input.events.map((e) => e.packet!.streamId),
  );
  assert.deepEqual(withoutPackets(decorated), withoutPackets(input));
  assert.deepEqual(decoratePackets(decorated, "streamed"), decorated);
});

test("appearance reads stored skin verbatim and never writes into undecorated recordings", () => {
  const stored = freeze(
    transfer({
      packet: {
        id: "saved-packet",
        skin: { symbol: "saved-symbol", color: "#123456" },
        streamId: "saved-stream",
        segment: 8,
      },
    }),
  );
  assert.deepEqual(packetAppearance(stored), {
    symbol: "saved-symbol",
    color: "#123456",
    elongated: true,
    id: "saved-packet",
  });
  const raw = freeze(structuredClone(original)),
    before = JSON.stringify(raw);
  const appearances = raw.events.map(packetAppearance);
  assert.deepEqual(raw.events.map(packetAppearance), appearances);
  assert.deepEqual(
    (JSON.parse(before) as Recording).events.map(packetAppearance),
    appearances,
  );
  assert(appearances.every((a) => !a.elongated && a.id.startsWith("event:")));
  assert.equal(new Set(appearances.map((a) => a.id)).size, appearances.length);
  assert.equal(JSON.stringify(raw), before);
  assert(!raw.events.some((e) => Object.hasOwn(e, "packet")));
  const event = raw.events.find((e) => e.kind === "transfer")!;
  assert.deepEqual(
    packetAppearance({ ...event, time: 99999, data: { unrelated: ["data"] } }),
    packetAppearance(event),
  );
});

test("world YAML rejects runtime appearance and stream metadata at every declaration boundary", () => {
  const packet = {
    id: "packet",
    skin: { symbol: "\\u2648", color: "#123456" },
    streamId: "stream",
    segment: 0,
  };
  for (const [key, value] of Object.entries({
    skin: packet.skin,
    packet,
    streamId: packet.streamId,
    segment: packet.segment,
  })) {
    for (const place of [
      "world",
      "node",
      "route",
      "output",
      "field",
    ] as const) {
      const d = draft(callSource),
        node = d.domain.手表.node.提交;
      if (place === 'route') {
        node.route[0] = {statement: node.route[0], [key]: value};
      } else {
        const target =
          place === "world"
            ? d
            : place === "node"
              ? node
              : place === "output"
                ? node.output.发送
                : node.packet.文案.文案;
        Object.assign(target, { [key]: value });
      }
      assert.throws(() => parseWorld(sourceOf(d)), Error, `${place}.${key}`);
    }
  }
});

test("stored packet appearances, causality and replay survive serialization without rerunning business logic", () => {
  const decorated = decoratePackets(original, "recorded");
  const snapshot = JSON.stringify(decorated),
    reloaded = JSON.parse(snapshot) as Recording;
  assert.deepEqual(reloaded, decorated);
  assert.deepEqual(
    reloaded.events.map(packetAppearance),
    decorated.events.map(packetAppearance),
  );
  assert.deepEqual(stateAt(reloaded, 0), original.initial);
  assert.deepEqual(stateAt(reloaded, reloaded.duration), original.final);
  assert.deepEqual(reloaded.coverage, original.coverage);
  assert(!Object.hasOwn(reloaded, "format"));
  packetAppearance(reloaded.events.find((e) => e.packet)!);
  assert.equal(JSON.stringify(reloaded), snapshot);
});
