import { coordinateText as C } from "../core/coordinate";
import { R } from "./fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorld } from "../core/model";
import { simulate, type Recording } from "../core/engine";
import { frontendInput, frontendOutputs } from "../core/frontend";
import {
  echoSource,
  callSource,
  normalStart,
  echoStart,
  draft,
  sourceOf,
} from "./fixtures";

test("UI input targets a declared node directly and has no preset defaults", () => {
  const world = parseWorld(echoSource);
  const request = frontendInput(world, "前台", C("前台/提问", "node"), {
    内容: "任意实际内容",
  });
  assert.deepEqual(request, {
    node: "前台/提问",
    name: "提问",
    input: { 内容: "任意实际内容" },
  });
  const r = simulate(world, request);
  assert.equal(r.status, "completed", r.error);
  assert.deepEqual(r.final.记录, [{ 内容: "任意实际内容" }]);
  assert.equal(
    frontendOutputs(world, "前台", r, r.duration)[C("前台/提问", "node")].data.内容,
    "任意实际内容",
  );
  assert.throws(
    () => frontendInput(world, "前台", C("前台/提问", "node"), {}),
    /缺少必填字段 内容/,
  );
});

test("frontend accepts only existing nodes in its own UI domain", () => {
  const world = parseWorld(echoSource);
  for (const [domain, node] of [
    ["前台", "服务/回声"],
    ["服务", "服务/回声"],
    ["缺失", "前台/提问"],
    ["前台", "前台/缺失"],
    ["前台", "正常"],
  ])
    assert.throws(() => frontendInput(world, domain, node, {}), /本域 UI/);
});

test("frontend accepts typed numbers and booleans without form coercion", () => {
  const d = draft(echoSource);
  Object.assign(d.domain.前台.node.提问.packet.问题, {
    分数: { type: "number" },
    安全: { type: "boolean" },
    注释: { type: "text", optional: true },
  });
  d.domain.服务.node.回声.input = R("前台/提问/回声");
  const world = parseWorld(sourceOf(d));
  assert.deepEqual(
    frontendInput(world, "前台", C("前台/提问", "node"), {
      内容: "",
      分数: 55,
      安全: true,
    }).input,
    { 内容: "", 分数: 55, 安全: true },
  );
  const invalid = [
    { 内容: "", 分数: "55", 安全: true },
    { 内容: "", 分数: NaN, 安全: true },
    { 内容: "", 分数: Infinity, 安全: true },
    { 内容: "", 分数: 55, 安全: "false" },
    { 内容: "", 分数: 55, 安全: true, 任意: "x" },
    { 内容: [], 分数: 55, 安全: true },
  ];
  for (const values of invalid)
    assert.throws(() => frontendInput(world, "前台", C("前台/提问", "node"), values));
  for (const input of [null, [], "text", 3, false, undefined])
    assert.throws(
      () => frontendInput(world, "前台", C("前台/提问", "node"), input),
      /应为对象/,
    );
  assert.throws(
    () =>
      frontendInput(
        world,
        "前台",
        C("前台/提问", "node"),
        JSON.parse('{"内容":"ok","分数":55,"安全":true,"constructor":"x"}'),
      ),
    /未声明字段/,
  );
});

test("frontend accepts opaque objects and arrays and clones their contents", () => {
  const d = draft(echoSource);
  d.domain.前台.node.提问.packet.问题.详情 = "object";
  d.domain.前台.node.提问.packet.问题.列表 = "object";
  d.domain.服务.node.回声.input = R("前台/提问/回声");
  const world = parseWorld(sourceOf(d));
  assert.throws(
    () => frontendInput(world, "前台", C("前台/提问", "node"), { 内容: "x" }),
    /缺少必填字段 详情/,
  );
  const input = { 内容: "x", 详情: { 标题: "x" }, 列表: [{ 分数: 55 }] };
  const request = frontendInput(world, "前台", C("前台/提问", "node"), input);
  assert.deepEqual(request.input, input);
  assert.equal(simulate(world, request).status, "completed");
  input.详情.标题 = "外部修改";
  input.列表[0].分数 = 0;
  assert.deepEqual(request.input, {
    内容: "x",
    详情: { 标题: "x" },
    列表: [{ 分数: 55 }],
  });
  for (const invalid of [
    { 内容: "x", 详情: null, 列表: [] },
    { 内容: "x", 详情: "x", 列表: [] },
    { 内容: "x", 详情: { 标题: "x" }, 列表: 55 },
  ])
    assert.throws(
      () => frontendInput(world, "前台", C("前台/提问", "node"), invalid),
      /应为|未声明字段/,
    );
});

test("opaque object fields still require true JSON values", () => {
  const d = draft(echoSource),
    fields = d.domain.前台.node.提问.packet.问题;
  fields.详情 = { type: "object" };
  fields.列表 = { type: "object" };
  d.domain.服务.node.回声.input = R("前台/提问/回声");
  const world = parseWorld(sourceOf(d));
  const input = {
    内容: "x",
    详情: { 子级: { number: 7, empty: null } },
    列表: [1, false, "x", null, { nested: [3] }],
  };
  assert.deepEqual(
    frontendInput(world, "前台", C("前台/提问", "node"), input).input,
    input,
  );
  for (const invalid of [
    undefined,
    NaN,
    Infinity,
    () => 1,
    1n,
    Symbol("x"),
    new Date(),
    new Map(),
  ]) {
    assert.throws(
      () =>
        frontendInput(world, "前台", C("前台/提问", "node"), {
          ...input,
          详情: { value: invalid },
        }),
      /有效 JSON/,
    );
    assert.throws(
      () =>
        frontendInput(world, "前台", C("前台/提问", "node"), {
          ...input,
          列表: [invalid],
        }),
      /有效 JSON/,
    );
  }
});

test("playback shows only observed output events from nodes of the same UI domain", () => {
  const world = parseWorld(callSource),
    r = simulate(world, normalStart);
  assert.deepEqual(frontendOutputs(world, "手表", null, r.duration), {});
  assert.deepEqual(frontendOutputs(world, "手表", r, 0), {});
  const visible = frontendOutputs(world, "手表", r, r.duration);
  assert.deepEqual(Object.keys(visible), [C("手表/提交", "node"), C("手表/播放", "node")]);
  assert.equal(visible[C("手表/播放", "node")].data.音频, normalStart.input.文案);
  assert.deepEqual(frontendOutputs(world, "业务", r, r.duration), {});
  assert.deepEqual(frontendOutputs(world, "缺失", r, r.duration), {});
  const output = r.events.find(
    (e) => e.node === "手表/播放" && e.kind === "output",
  )!;
  assert(
    !Object.hasOwn(
      frontendOutputs(world, "手表", r, output.time - 1),
      C("手表/播放", "node"),
    ),
  );
  assert(
    Object.hasOwn(frontendOutputs(world, "手表", r, output.time), C("手表/播放", "node")),
  );
  visible[C("手表/播放", "node")].data.音频 = "污染";
  assert.equal(output.data.音频, normalStart.input.文案);
});

test("frontend replay uses the latest output at the selected time and scrubs backwards", () => {
  const world = parseWorld(echoSource),
    recording = simulate(world, echoStart);
  const first = recording.events.find(
    (e) => e.kind === "output" && e.node === echoStart.node,
  )!;
  recording.events.push({
    ...structuredClone(first),
    id: recording.events.length + 1,
    time: first.time + 500,
    data: { 内容: "第二次" },
  });
  const reloaded = JSON.parse(JSON.stringify(recording)) as Recording;
  const before = structuredClone(reloaded);
  assert.equal(
    frontendOutputs(world, "前台", reloaded, first.time + 499)[C("前台/提问", "node")].data
      .内容,
    "实际输入",
  );
  assert.equal(
    frontendOutputs(world, "前台", reloaded, first.time + 500)[C("前台/提问", "node")].data
      .内容,
    "第二次",
  );
  assert.deepEqual(frontendOutputs(world, "前台", reloaded, 0), {});
  assert.deepEqual(reloaded, before);
});

test("UI requires a directory view; services cannot declare UI views or old frontend declarations", () => {
  for (const change of [
    (d: any) => {
      delete d.domain.前台.view;
    },
    (d: any) => {
      delete d.domain.前台.type;
    },
    (d: any) => {
      d.domain.服务.view = d.domain.前台.view;
    },
    (d: any) => {
      d.domain.前台.view.width = 10000;
    },
    (d: any) => {
      d.domain.前台.view.directory = "../outside";
    },
    (d: any) => {
      d.domain.前台.view.directory = "/absolute";
    },
    (d: any) => {
      d.domain.前台.view.html = "<p>old</p>";
    },
    (d: any) => {
      d.domain.前台.view.entries = ["正常"];
    },
    (d: any) => {
      d.domain.前台.view.outputs = [C("前台/提问", "node")];
    },
  ]) {
    const d = draft(echoSource);
    change(d);
    assert.throws(() => parseWorld(sourceOf(d)));
  }
});
