import { R } from "./fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorld, inputPacketId, outputPacketId } from "../core/model";
import { roadsFor, fablesFor, type Road } from "../core/topology";
import { callSource, echoSource, draft, sourceOf } from "./fixtures";

test("roads aggregate calls and sends across domains without mutating the world", () => {
  const world = parseWorld(callSource),
    before = structuredClone(world);
  const expected: Road[] = [
    { id: "road:业务|手表", from: "业务", to: "手表" },
    { id: "road:业务|语音", from: "业务", to: "语音" },
  ];
  assert.deepEqual(roadsFor(world), expected);
  assert.deepEqual(world, before);
  world.nodes.reverse();
  for (const node of world.nodes) node.outputs.reverse();
  assert.deepEqual(roadsFor(world), expected);
});

test("root identity, object keys and packet coordinates compile without source metadata", () => {
  const world = parseWorld(echoSource),
    node = world.nodes[0],
    output = node.outputs[0];
  assert.equal(world.name, "回声世界");
  assert.equal(world.description, "");
  for (const key of ["app", "format", "entries"])
    assert(!Object.hasOwn(world, key));
  assert.equal(world.domains[0].id, world.domains[0].name);
  assert.equal(world.domains[1].type, undefined);
  assert.equal(node.id, "前台/提问");
  assert.equal(node.domain, "前台");
  assert.equal(node.name, "提问");
  assert.equal(node.description, "");
  assert.equal(inputPacketId(node), "前台/提问/问题");
  assert.equal(outputPacketId(node, output), "前台/提问/回声");
  assert.deepEqual(world.resources, [
    { id: "记录", name: "记录", fields: { 内容: { type: "text" } } },
  ]);
  assert.deepEqual(world.fables[0], {target: "前台/提问/问题", type: "packet", text: "输入有明确合同"});
});

test("all packet definitions resolve before cross-node input and output references", () => {
  const world = parseWorld(callSource);
  const caller = world.nodes.find((n) => n.id === "业务/朗读")!;
  const callee = world.nodes.find((n) => n.id === "语音/合成")!;
  assert.equal(caller.inputPacket, "手表/提交/文案");
  assert.deepEqual(caller.outputs[0].fields, callee.packets.音频);
  assert.notEqual(caller.outputs[0].fields, callee.packets.音频);
  caller.outputs[0].fields.音频.type = "number";
  assert.equal(callee.packets.音频.音频.type, "text");
  assert.equal(callee.outputs[0].fields.音频.type, "text");
  const input = world.nodes.find((n) => n.id === "手表/提交")!;
  caller.input.文案.type = "number";
  assert.equal(input.input.文案.type, "text");
  assert.equal(input.packets.文案.文案.type, "text");
});

test("reference-only nodes may omit packets without inferring missing definitions", () => {
  const source = callSource.replace(/^ *packets: \{\}\n/gm, "");
  const world = parseWorld(source);
  assert.deepEqual(world, parseWorld(callSource));
  assert.deepEqual(world.nodes.find((n) => n.id === "业务/朗读")!.packets, {});
  const d = draft(source);
  delete d.domain.语音.node.合成.packet;
  assert.throws(() => parseWorld(sourceOf(d)), /数据包引用不存在/);
});

test("dangling packet references, node destinations and noncanonical coordinates fail", () => {
  for (const ref of [
    "不存在/节点/包",
    "前台/提问",
    "前台/提问/输入/问题",
    "前台/提问/constructor",
  ]) {
    const d = draft(echoSource);
    d.domain.前台.node.提问.input = ref;
    assert.throws(() => parseWorld(sourceOf(d)));
  }
  const d = draft(echoSource);
  d.domain.前台.node.提问.output.非空.packet = R("服务/回声/缺失");
  assert.throws(() => parseWorld(sourceOf(d)), /数据包引用不存在/);
  d.domain.前台.node.提问.output.非空.packet = R("前台/提问/回声");
  d.domain.前台.node.提问.output.非空.action = ['go([不存在:domain/节点:node], output)'];
  assert.throws(() => parseWorld(sourceOf(d)), /去向.*不存在/);
});

test("packet contracts, required outputs and writes are statically checked", () => {
  for (const change of [
    (d: any) => {
      d.domain.前台.node.提问.route[0] = "IF input.内容 != '' go([非空:output], {内容:7})";
    },
    (d: any) => {
      d.domain.前台.node.提问.route[0] = "IF input.内容 != '' go([非空:output], {})";
    },
    (d: any) => {
      d.domain.前台.node.提问.route[0] = "IF input.内容 != '' go([非空:output], {内容:input.内容, 额外:'x'})";
    },
    (d: any) => {
      delete d.domain.前台.node.提问.output.非空.packet;
    },
    (d: any) => {
      d.domain.前台.node.提问.output.非空.action[0] = "write([记录:resource], {内容:7})";
    },
    (d: any) => {
      d.domain.前台.node.提问.output.非空.action[0] = "write([缺失:resource], {内容:output.内容})";
    },
    (d: any) => {
      d.domain.前台.node.提问.packet.回声.内容.optional = true;
      d.domain.前台.node.提问.output.非空.action.push('go([服务:domain/回声:node], output)');
    },
    (d: any) => {
      d.domain.服务.node.回声.output.完成.action.push('go([前台:domain/提问:node], output)');
    },
    (d: any) => {
      d.domain.前台.node.提问.route[0] = "IF input.内容 != '' go([非空:output], {内容:output.内容})";
    },
  ]) {
    const d = draft(echoSource);
    change(d);
    assert.throws(() => parseWorld(sourceOf(d)));
  }
});

test("go validates every destination contract, including optional fields", () => {
  const d = draft(callSource);
  d.domain.手表.node.复制 = structuredClone(d.domain.手表.node.播放);
  d.domain.业务.node.朗读.output.有语音.action.push('go([手表:domain/复制:node], output)');
  assert.equal(parseWorld(sourceOf(d)).nodes.length, 6);
  for (const contract of [
    { 音频: { type: "number" } },
    { 音频: { type: "text", optional: true } },
    { 音频: { type: "text" }, 更多: { type: "text", optional: true } },
  ]) {
    d.domain.手表.node.复制.packet = { 请求: contract };
    d.domain.手表.node.复制.input = R("手表/复制/请求");
    assert.throws(() => parseWorld(sourceOf(d)), /广播目标合同不匹配/);
  }
});

test("fable scopes accept packets, domains, nodes, resources and canonical roads", () => {
  const d = draft(echoSource);
  d.fable.push(
    [R('前台', 'domain'), '域'],
    [R('前台/提问', 'node'), '节点'],
    [R('记录', 'resource'), '资源'],
    [['服务|前台:road'], '道路'],
    [R('前台/提问/非空', 'output'), '出口'],
  );
  const world = parseWorld(sourceOf(d)),
    before = structuredClone(world);
  assert.deepEqual(
    fablesFor(world, "前台").map((f) => f.text),
    ["输入有明确合同", "域", "节点", "出口"],
  );
  assert.deepEqual(
    fablesFor(world, "前台/提问").map((f) => f.text),
    ["输入有明确合同", "节点", "出口"],
  );
  assert.deepEqual(
    fablesFor(world, "前台/提问/问题").map((f) => f.text),
    ["输入有明确合同"],
  );
  assert.deepEqual(
    fablesFor(world, "记录").map((f) => f.text),
    ["资源"],
  );
  assert.deepEqual(
    fablesFor(world, "road:前台|服务").map((f) => f.text),
    ["道路"],
  );
  assert.deepEqual(fablesFor(world, "缺失"), []);
  assert.deepEqual(world, before);
});

test("fables require an existing absolute coordinate and nonempty text", () => {
  for (const line of [
    [["缺失:domain"], "内容"],
    [["前台:domain/缺失:node"], "内容"],
    [["前台:domain/提问:node/缺失:output"], "内容"],
    [["前台:domain/提问:node/问题:output"], "类型错"],
    [["前台|缺失:road"], "内容"],
    [["提问:node"], "缺少大域"],
    [["前台:domain"], "  "],
    "[前台:domain] 旧格式",
    "没有坐标",
  ]) {
    const d = draft(echoSource);
    d.fable.push(line);
    assert.throws(() => parseWorld(sourceOf(d)));
  }
});

test("coordinate keys are canonical and domain/resource identities cannot collide", () => {
  for (const key of ["a/b", "a.b", "has space", "__proto__", "constructor"]) {
    const d = draft(echoSource);
    Object.defineProperty(d.domain, key, {
      value: d.domain.前台,
      enumerable: true,
    });
    assert.throws(() => parseWorld(sourceOf(d)));
  }
  const d = draft(echoSource);
  d.resource.前台 = { field: {} };
  assert.throws(() => parseWorld(sourceOf(d)), /重复坐标/);
});
