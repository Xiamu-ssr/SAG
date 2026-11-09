import { coordinateText as C } from "../core/coordinate";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fields, Node, World } from "../core/model";
import type { Event, Recording } from "../core/engine";
import { frontendInput, frontendOutputs } from "../core/frontend";
import { frontendUrl } from "../src/frontendDocument";
import { mapLayout } from "../src/mapLayout";

const fields: Fields = {
  message: { type: "text" },
  count: { type: "number" },
  detail: { type: "object" },
  tags: { type: "object" },
};
function node(domain: string, name: string): Node {
  const id = `${domain}/${name}`;
  return {
    id, name, domain, description: "", packets: { request: fields },
    inputPacket: `${id}/request`, input: fields, duration: 300, outputs: [],
  };
}
const world: World = {
  name: "bridge", description: "", fables: [], resources: [], services: [],
  domains: [
    { id: "UI", name: "UI", description: "", color: "#348767", type: "UI", view: { directory: "frontend", width: 360, height: 280 } },
    { id: "service", name: "service", description: "", color: "#348767" },
    { id: "other", name: "other", description: "", color: "#348767", type: "UI", view: { directory: "other-ui", width: 360, height: 280 } },
  ],
  nodes: [node("UI", "input"), node("UI", "display"), node("service", "work"), node("other", "input")],
};
const input = { message: "hello", count: 2, detail: { active: true }, tags: ["one", "two"] };

test("iframe uses directory assets, an encoded UI coordinate and a channel", () => {
  assert.equal(
    frontendUrl("/api/runs/run-1/assets", "前台", "nonce-1"),
    "/api/runs/run-1/assets/%E5%89%8D%E5%8F%B0/index.html?channel=nonce-1",
  );
});

test("iframe input validates the actual typed packet and restricts its UI domain", () => {
  assert.deepEqual(frontendInput(world, "UI", C("UI/input", "node"), input), { node: "UI/input", input, name: "input" });
  for (const target of ["other/input", "service/work", "missing"])
    assert.throws(() => frontendInput(world, "UI", target, input), /本域 UI/);
  assert.throws(() => frontendInput(world, "service", C("service/work", "node"), input), /本域 UI/);
  for (const invalid of [null, [], { ...input, count: "2" }, { ...input, detail: true }, { ...input, tags: "one" }, { ...input, extra: true }])
    assert.throws(() => frontendInput(world, "UI", C("UI/input", "node"), invalid));
});

test("iframe view and results contain only actual UI output events up to the requested time", () => {
  const event = (id: number, node: string, kind: Event["kind"], time: number): Event => ({
    id, node, kind, time, invocation: 1, branch: "done", data: { id },
  });
  const recording: Recording = {
    mode: "simulation", complete: true, status: "completed", entry: "UI/input",
    start: { node: "UI/input", input }, duration: 100, initial: {}, final: {}, coverage: [],
    events: [
      event(1, "UI/input", "enter", 0),
      event(2, "UI/input", "output", 10),
      event(3, "service/work", "output", 20),
      event(4, "other/input", "output", 30),
      event(5, "UI/display", "output", 40),
      event(6, "UI/display", "output", 80),
    ],
  };
  assert.deepEqual(frontendOutputs(world, "UI", recording, 0), {});
  assert.deepEqual(frontendOutputs(world, "UI", recording, 50), {
    [C("UI/input", "node")]: { branch: "done", data: { id: 2 } },
    [C("UI/display", "node")]: { branch: "done", data: { id: 5 } },
  });
  assert.deepEqual(frontendOutputs(world, "UI", recording, 100)[C("UI/display", "node")].data, { id: 6 });
  assert.deepEqual(frontendOutputs(world, "service", recording, 100), {});
  assert.deepEqual(frontendOutputs(world, "UI", null, 100), {});
});

test("temporary iframe resizing reserves map space without modifying the world", () => {
  const before = structuredClone(world);
  const normal = mapLayout(world);
  const resized = mapLayout(world, { UI: { width: 700, height: 600 } });
  assert(resized.width > normal.width);
  assert(resized.height > normal.height);
  const center = resized.centers.get("UI")!;
  for (const n of world.nodes.filter((n) => n.domain === "UI"))
    assert(resized.nodes.get(n.id)!.y > center.y + 300);
  assert(resized.centers.get("service")!.x - resized.bounds.get("service")!.width / 2 > center.x + resized.bounds.get("UI")!.width / 2);
  assert.deepEqual(world, before);
});
