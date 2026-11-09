import { R } from "./fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorld, checkData, type Fields } from "../core/model";
import { simulate } from "../core/engine";
import {
  callSource,
  normalStart,
  emptyStart,
  draft,
  sourceOf,
} from "./fixtures";

test("sequential calls suspend and resume one invocation without reentering input", () => {
  const world = parseWorld(callSource),
    r = simulate(world, normalStart);
  assert.equal(r.status, "completed", r.error);
  assert.deepEqual(r.final.交付记录, [{ 内容: normalStart.input.文案 }]);
  const events = r.events.filter((e) => e.node === "业务/朗读");
  assert.equal(events.filter((e) => e.kind === "enter").length, 1);
  assert.equal(events.filter((e) => e.kind === "resume").length, 2);
  assert.deepEqual(
    events.filter((e) => e.kind === "call").map((e) => e.callName),
    ["准备结果", "语音结果"],
  );
  assert(
    events.find((e) => e.kind === "end")!.time >
      r.events.find((e) => e.kind === "end" && e.node === "语音/合成")!.time,
  );
});

test("business failure is a routed reply, not an engine exception", () => {
  const r = simulate(parseWorld(callSource), emptyStart);
  assert.equal(r.status, "completed", r.error);
  assert(r.coverage.includes("业务/朗读#无语音"));
  assert(!r.events.some((e) => e.node === "手表/播放"));
  assert(!r.coverage.includes("手表/播放#播放"));
  assert.equal(
    r.events.find((e) => e.kind === "resume" && e.callName === "语音结果")!.data
      .分支,
    "失败",
  );
});

test("concurrent invocations of one caller retain independent reply identities", () => {
  const d = draft();
  d.domain.手表.node.提交.output.发送.action.push('go([业务:domain/朗读:node], output)');
  const r = simulate(parseWorld(sourceOf(d)), normalStart);
  assert.equal(r.status, "completed", r.error);
  const callers = r.events.filter(
    (e) => e.node === "业务/朗读" && e.kind === "enter",
  );
  assert.equal(callers.length, 2);
  for (const caller of callers) {
    const events = r.events.filter((e) => e.invocation === caller.invocation);
    assert.deepEqual(
      events.filter((e) => e.kind === "resume").map((e) => e.callId),
      events.filter((e) => e.kind === "call").map((e) => e.callId),
    );
  }
  assert.equal(
    new Set(r.events.filter((e) => e.kind === "call").map((e) => e.callId))
      .size,
    4,
  );
  assert.equal(r.final.交付记录.length, 2);
});

test("nested calls return to the immediate waiting invocation", () => {
  const d = draft(),
    prep = d.domain.业务.node.整理;
  prep.logic = ['中间 = call([业务:domain/回声:node], {文案: input.文案})'];
  prep.route = ['go([完成:output], {文案:中间.数据.文案})'];
  d.domain.业务.node.回声 = {
    packet: {},
    input: R("手表/提交/文案"),
    route: ['go([完成:output], {文案:input.文案})'],
    output: {
      完成: {
        packet: R("手表/提交/文案"),
        action: ['return()'],
      },
    },
  };
  const r = simulate(parseWorld(sourceOf(d)), normalStart);
  assert.equal(r.status, "completed", r.error);
  assert.equal(r.events.filter((e) => e.kind === "resume").length, 3);
  for (const resume of r.events.filter((e) => e.kind === "resume")) {
    const reply = r.events.find(
      (e) => e.kind === "reply" && e.invocation === resume.callId,
    )!;
    assert.equal(reply.parent, resume.invocation);
    assert.equal(reply.target, resume.node);
  }
});

test("different callers share a callee without mixing payloads", () => {
  const d = draft();
  d.domain.业务.node.另一调用方 = {
    packet: {},
    input: R("手表/提交/文案"),
    logic: ['结果 = call([业务:domain/整理:node], {文案: "另一份内容"})'],
    route: ['go([完成:output], {文案:结果.数据.文案})'],
    output: {
      完成: {
        packet: R("手表/提交/文案"),
      },
    },
  };
  d.domain.手表.node.提交.output.发送.action.push('go([业务:domain/另一调用方:node], output)');
  const r = simulate(parseWorld(sourceOf(d)), normalStart);
  assert.equal(r.status, "completed", r.error);
  assert.equal(
    r.events.find((e) => e.kind === "output" && e.node === "业务/另一调用方")!
      .data.文案,
    "另一份内容",
  );
  assert.equal(
    r.events.find((e) => e.kind === "output" && e.node === "手表/播放")!.data
      .音频,
    normalStart.input.文案,
  );
});

test("calls validate targets, arguments, order, aliases and branch-specific result types", () => {
  const cases: Array<[string, RegExp]> = [
    ['结果 = call([语音:domain/不存在:node], {文本: input.文案})', /目标不存在/],
    ['结果 = call([语音:domain/合成:node], {文本: 7})', /应为 text/],
    ['结果 = call([语音:domain/合成:node], {})', /缺少必填/],
    ['结果 = call([语音:domain/合成:node], {文本: 稍后.数据.文案})', /未声明/],
    ['input = call([语音:domain/合成:node], {文本: input.文案})', /变量重复/],
  ];
  for (const [statement, error] of cases) {
    const d = draft();
    d.domain.业务.node.朗读.logic = [statement];
    assert.throws(() => parseWorld(sourceOf(d)), error);
  }
  const d = draft();
  d.domain.业务.node.朗读.route[0] = "IF input.文案 != '' go([有语音:output], {音频:语音结果.数据.音频})";
  assert.throws(() => parseWorld(sourceOf(d)), /先根据.*分支/);
  const duplicate = draft();
  duplicate.domain.业务.node.朗读.logic[1] =
    duplicate.domain.业务.node.朗读.logic[0];
  assert.throws(() => parseWorld(sourceOf(duplicate)), /变量重复/);
  const wrongBranch = draft();
  wrongBranch.domain.业务.node.朗读.route[0] = wrongBranch.domain.业务.node.朗读.route[0].replace('成功', '不存在');
  assert.throws(() => parseWorld(sourceOf(wrongBranch)), /不存在返回分支/);
});

test("!= branch refinement includes the complementary final route", () => {
  const d = draft(),
    n = d.domain.业务.node.朗读;
  n.route = [
    'IF 语音结果.分支 != "成功" go([无语音:output], {原因:语音结果.数据.原因})',
    'go([有语音:output], {音频:语音结果.数据.音频})',
  ];
  const world = parseWorld(sourceOf(d));
  assert(simulate(world, normalStart).coverage.includes("业务/朗读#有语音"));
  assert(simulate(world, emptyStart).coverage.includes("业务/朗读#无语音"));
});

test("reply without caller, one-way delivery to reply nodes, nonreply callees and recursion fail", () => {
  const r = simulate(parseWorld(callSource), {
    node: "语音/合成",
    input: { 文本: "直接启动" },
  });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /没有逻辑区调用方/);
  const d = draft();
  d.domain.手表.node.提交.output.发送.action = ['go([业务:domain/整理:node], output)'];
  assert.throws(() => parseWorld(sourceOf(d)), /需要调用方/);
  const missing = draft();
  delete missing.domain.语音.node.合成.output.成功.action;
  assert.throws(() => parseWorld(sourceOf(missing)), /所有输出都必须回复/);
  const recursive = draft();
  recursive.domain.业务.node.整理.logic = [
    '循环 = call([业务:domain/整理:node], {文案: input.文案})',
  ];
  assert.throws(() => parseWorld(sourceOf(recursive)), /递归调用/);
});

test("arbitrary code is declared as an external service rather than node logic", () => {
  const d = draft();
  d.domain.语音.node.合成.logic = { type: "binding", ref: "未接入" };
  assert.throws(() => parseWorld(sourceOf(d)), /合成.logic/);
});

test("optional values remain absent through nested calls and final output", () => {
  const d = draft();
  d.domain.手表.node.提交.packet.文案.文案.optional = true;
  d.domain.业务.node.朗读.logic = [
    '准备结果 = call([业务:domain/整理:node], {文案: input.文案})',
  ];
  d.domain.业务.node.朗读.route = ['go([完成:output], {文案:准备结果.数据.文案})'];
  d.domain.业务.node.朗读.output = {
    完成: {
      packet: R("手表/提交/文案"),
    },
  };
  delete d.fable;
  const world = parseWorld(sourceOf(d)),
    r = simulate(world, { node: "手表/提交", input: {} });
  assert.equal(r.status, "completed", r.error);
  assert.deepEqual(
    r.events.find((e) => e.kind === "output" && e.node === "业务/朗读")!.data,
    {},
  );
  d.domain.业务.node.朗读.output.完成.packet = R("语音/合成/请求");
  d.domain.业务.node.朗读.route = ['go([完成:output], {文本:准备结果.数据.文案})'];
  assert.throws(() => parseWorld(sourceOf(d)), /必填合同不匹配/);
});

test("opaque objects can carry arbitrary JSON containers but cannot be read as nested fields", () => {
  const fields: Fields = {
    详情: { type: "object" },
    列表: { type: "object" },
  };
  checkData({ 详情: { 名称: 7 }, 列表: [1, null, "叶子"] }, fields, "包");
  assert.throws(
    () => checkData({ 详情: null, 列表: [] }, fields, "包"),
    /详情 应为 object/,
  );
  assert.throws(
    () => checkData({ 详情: {}, 列表: "7" }, fields, "包"),
    /列表 应为 object/,
  );
  const d = draft(),
    n = d.domain.手表.node.提交;
  n.packet.嵌套 = {详情: 'object', 列表: 'object'};
  n.input = R("手表/提交/嵌套");
  n.route = ['go([发送:output], {文案:input.详情.名称})'];
  assert.throws(() => parseWorld(sourceOf(d)), /不能读取字段内部/);
  n.route = ['go([发送:output], {文案:input.列表})'];
  assert.throws(() => parseWorld(sourceOf(d)), /类型\/必填合同不匹配/);
  n.packet.传递 = {文案: 'object'};
  n.output.发送.packet = R('手表/提交/传递');
  delete n.output.发送.action;
  const run = simulate(parseWorld(sourceOf(d)), {
    node: "手表/提交",
    input: { 详情: { 名称: "叶子" }, 列表: [1, null, "叶子"] },
  });
  assert.deepEqual(run.events.find(e => e.kind === 'output')?.data, {文案: [1, null, '叶子']});
});

test("recorded causality follows replies to each caller without mixing concurrent paths", () => {
  const d = draft();
  d.domain.业务.node.空文案 = {
    duration: 0,
    packet: {},
    input: R("手表/提交/文案"),
    route: ['go([提交:output], {文案:""})'],
    output: {
      提交: {
        packet: R("手表/提交/文案"),
        action: ['go([业务:domain/朗读:node], output)'],
      },
    },
  };
  d.domain.手表.node.提交.output.发送.action.push('go([业务:domain/空文案:node], output)');
  const world = parseWorld(sourceOf(d)),
    r = simulate(world, normalStart);
  assert.equal(r.status, "completed", r.error);
  const events = JSON.parse(JSON.stringify(r.events)) as typeof r.events;
  const byId = new Map(events.map(e => [e.id, e]));
  const path = (event: typeof events[number]) => {
    const route = [];
    while (event.cause !== undefined) {
      const parent = byId.get(event.cause)!;
      assert(parent && parent.id < event.id);
      route.push(parent);
      event = parent;
    }
    return route;
  };
  const failed = events.find(e => e.kind === 'output' && e.branch === '无语音')!;
  const playback = events.filter(e => e.node === '手表/播放' && e.kind === 'enter');
  assert.equal(playback.length, 1);
  assert(path(failed).some(e => e.kind === 'reply' && e.branch === '失败'));
  assert(path(playback[0]).some(e => e.kind === 'reply' && e.branch === '成功'));
  assert(!path(playback[0]).some(e => e.kind === 'reply' && e.branch === '失败'));
});
