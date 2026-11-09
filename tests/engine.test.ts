import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorld, readPath, type Data } from "../core/model";
import {
  simulate,
  stateAt,
  type Recording,
  type Start,
} from "../core/engine";
import {
  callSource,
  echoSource,
  echoStart,
  normalStart,
  draft,
  sourceOf,
} from "./fixtures";

test("recordings retain explicit starts and contain no format version", () => {
  const start: Start = { ...structuredClone(echoStart), name: "自由输入" };
  const r = simulate(parseWorld(echoSource), start);
  assert.equal(r.status, "completed", r.error);
  assert.equal(r.complete, true);
  assert.equal(r.mode, "simulation");
  assert.equal(r.entry, start.node);
  assert.deepEqual(r.start, start);
  assert(!Object.hasOwn(r, "format"));
  start.input.内容 = "之后修改";
  assert.equal(r.start.input.内容, "实际输入");
  assert.equal(r.events[0].data.内容, "实际输入");
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test("start objects directly select input nodes and IF output routes", () => {
  const world = parseWorld(echoSource);
  const high = simulate(world, echoStart),
    low = simulate(world, { ...echoStart, input: { 内容: "" } });
  assert(high.coverage.includes("前台/提问#非空"));
  assert(low.coverage.includes("前台/提问#为空"));
  assert.equal(low.status, "completed");
  const play = simulate(parseWorld(callSource), {
    node: "手表/播放",
    input: { 音频: "直接输入" },
  });
  assert.equal(play.events[0].node, "手表/播放");
  assert.equal(play.events.filter((e) => e.kind === "enter").length, 1);
});

test("string, missing and unknown starts are rejected without preset fallback", () => {
  const world = parseWorld(echoSource);
  for (const start of ["正常", "前台/提问", null, undefined, [], {}])
    assert.throws(
      () => simulate(world, start as unknown as Start),
      /显式 Start/,
    );
  assert.throws(
    () => simulate(world, { node: "不存在/节点", input: {} }),
    /小域.*不存在/,
  );
});

test("invalid inputs fail before output and writes", () => {
  const world = parseWorld(echoSource);
  const invalid = [
    {},
    { 内容: 7 },
    { 内容: null },
    { 内容: "ok", 额外: true },
    null,
    [],
    undefined,
  ];
  for (const input of invalid) {
    const r = simulate(world, { node: echoStart.node, input: input as Data });
    assert.equal(r.status, "failed");
    assert.deepEqual(
      r.events.map((e) => e.kind),
      ["error"],
    );
    assert.deepEqual(r.coverage, []);
    assert.deepEqual(r.final, r.initial);
  }
  assert.throws(() => readPath({}, "__proto__.x"), /原型/);
  assert.throws(() => readPath({}, "constructor"), /原型/);
});

test("runs are deterministic and deeply isolate world, start, resources and recordings", () => {
  const d = draft();
  d.resource.缓存 = { field: { payload: { type: "object" } } };
  const world = parseWorld(sourceOf(d));
  const initial: Record<string, Data[]> = {
    交付记录: [{ 内容: "已有记录" }],
    缓存: [{ payload: { items: ["initial"] } }],
  };
  const beforeWorld = structuredClone(world),
    beforeInitial = structuredClone(initial);
  const first = simulate(world, normalStart, initial),
    second = simulate(world, normalStart, initial);
  assert.deepEqual(first, second);
  assert.deepEqual(first.initial, initial);
  assert.equal(first.final.交付记录.length, 2);
  assert.deepEqual(stateAt(first, 0), initial);
  assert.deepEqual(stateAt(first, first.duration), first.final);
  (first.final.缓存[0].payload as { items: string[] }).items.push("mutation");
  first.events[0].data.文案 = "mutation";
  initial.交付记录[0].内容 = "external mutation";
  assert.deepEqual(second.initial, beforeInitial);
  assert.deepEqual(first.initial, beforeInitial);
  assert.deepEqual(world, beforeWorld);
  assert.equal(second.events[0].data.文案, normalStart.input.文案);
});

test("omitted initial data means all resources start empty, not YAML initial rows", () => {
  const world = parseWorld(callSource),
    r = simulate(world, normalStart);
  assert.deepEqual(r.initial, { 交付记录: [] });
  assert(!Object.hasOwn(world.resources[0], "initial"));
});

test("provided initial data must include every resource and validate all rows before running", () => {
  const world = parseWorld(callSource),
    before = structuredClone(world);
  for (const [initial, error] of [
    [{}, /初始资源缺少 交付记录/],
    [{ 交付记录: [], unknown: [] }, /unknown 不存在/],
    [{ 交付记录: {} }, /应为数组/],
    [{ 交付记录: [{ 内容: "有效" }, {}] }, /缺少必填字段 内容/],
    [{ 交付记录: [{ 内容: "有效", extra: true }] }, /未声明字段/],
    [{ 交付记录: [null] }, /数据应为对象/],
  ] as Array<[unknown, RegExp]>)
    assert.throws(
      () => simulate(world, normalStart, initial as Record<string, Data[]>),
      error,
    );
  assert.deepEqual(world, before);
});

test("stateAt replays only observed writes and supports repeated backwards scrubbing", () => {
  const world = parseWorld(callSource),
    r = simulate(world, normalStart, { 交付记录: [{ 内容: "旧记录" }] });
  const before = structuredClone(r),
    write = r.events.find((e) => e.kind === "write")!;
  assert.equal(stateAt(r, write.time - 1).交付记录.length, 1);
  assert.deepEqual(stateAt(r, write.time), r.final);
  assert.deepEqual(stateAt(r, r.duration), r.final);
  assert.equal(stateAt(r, 0).交付记录.length, 1);
  const state = stateAt(r, r.duration);
  state.交付记录[0].内容 = "污染";
  assert.deepEqual(r, before);
  const reloaded = JSON.parse(JSON.stringify(r)) as Recording;
  world.nodes.length = 0;
  assert.deepEqual(stateAt(reloaded, reloaded.duration), before.final);
});

test("business writes are atomic when one row cannot resolve or validate", () => {
  const world = parseWorld(callSource),
    output = world.nodes.find((n) => n.id === "业务/朗读")!.outputs[0];
  output.write.push({
    resource: "交付记录",
    values: { 内容: { $: "不存在" } },
  });
  const r = simulate(world, normalStart);
  assert.equal(r.status, "failed");
  assert.deepEqual(r.final, r.initial);
  assert(
    !r.events.some(
      (e) =>
        e.kind === "write" || (e.kind === "output" && e.node === "业务/朗读"),
    ),
  );
});

test("one-way cycles terminate with a recorded budget failure", () => {
  const world = parseWorld(callSource);
  world.nodes.find((n) => n.id === "手表/提交")!.outputs[0].to = ["手表/提交"];
  const r = simulate(world, normalStart);
  assert.equal(r.status, "failed");
  assert.match(r.error!, /运行超过边界/);
  assert.equal(r.events.at(-1)!.kind, "error");
});

test("invalid output data cannot write resources or cross a go boundary", () => {
  const world = parseWorld(callSource),
    output = world.nodes.find(n => n.id === "业务/朗读")!.outputs[0];
  output.values.音频 = 42;
  const run = simulate(world, normalStart);
  assert.equal(run.status, "failed");
  assert.match(run.error!, /音频 应为 text/);
  assert(!run.events.some(e => e.node === "手表/播放" || e.kind === "write"));
  assert.deepEqual(run.final, run.initial);
});
