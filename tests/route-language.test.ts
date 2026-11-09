import { R } from "./fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorld, compare, type Data } from "../core/model";
import { simulate } from "../core/engine";
import {
  routeText,
  conditionText,
  valueText,
} from "../src/routeLanguage";
import { echoSource, echoStart, draft, sourceOf } from "./fixtures";

test("human route labels are derived from compiled output conditions", () => {
  const world = parseWorld(echoSource),
    node = world.nodes[0];
  assert.equal(routeText(node, 0), "如果input.内容不等于“”，则非空");
  assert.equal(routeText(node, 1), "其余情况，为空");
  const condition = node.outputs[0].when!;
  assert("value" in condition);
  condition.value = "修改";
  assert.equal(routeText(node, 0), "如果input.内容不等于“修改”，则非空");
  assert.equal(routeText(world.nodes[1], 0), "回复调用方");
  assert.equal(
    conditionText({ field: "input.安全", op: "==", value: true }),
    "input.安全为真",
  );
  assert.equal(valueText({ $: "input.内容" }), "沿用输入的内容");
});

test("route order alone determines compiled outputs and executable conditions", () => {
  const world = parseWorld(echoSource),
    n = world.nodes[0];
  assert.deepEqual(
    n.outputs.map((o) => [o.id, o.label]),
    [
      ["非空", "非空"],
      ["为空", "为空"],
    ],
  );
  assert.deepEqual(n.outputs[0].when, {
    field: "input.内容",
    op: "!=",
    value: "",
  });
  assert(!Object.hasOwn(n.outputs[1], "when"));
  assert(!Object.hasOwn(n, "route"));
  assert(!Object.hasOwn(n, "branches"));
  assert(!Object.hasOwn(n, "router"));
  assert.equal(
    simulate(world, echoStart).events.find(
      (e) => e.node === n.id && e.kind === "output",
    )!.branch,
    "非空",
  );
  assert.equal(
    simulate(world, { ...echoStart, input: { 内容: "" } }).events.find(
      (e) => e.node === n.id && e.kind === "output",
    )!.branch,
    "为空",
  );
});

test("every output has exactly one route and only the final route is unconditional", () => {
  const invalid: Array<(n: any) => void> = [
    (n) => {
      delete n.route;
    },
    (n) => {
      n.route = [];
    },
    (n) => {
      n.route[0] = n.route[0].replace("IF input.内容 != '' ", "");
    },
    (n) => {
      n.route[1] = "IF input.内容 == '' go([为空:output], {内容:''})";
    },
    (n) => {
      n.route[1] = "go([非空:output], {内容:''})";
    },
    (n) => {
      n.route[1] = "go([不存在:output], {})";
    },
    (n) => {
      n.route[1] = "go([服务:domain/回声:node/完成:output], {})";
    },
    (n) => {
      n.output.未使用 = n.output.为空;
    },
    (n) => {
      n.output.非空.when = true;
    },
  ];
  for (const change of invalid) {
    const d = draft(echoSource);
    change(d.domain.前台.node.提问);
    assert.throws(() => parseWorld(sourceOf(d)));
  }
});

test("IF field references and comparison literal types are checked at compile time", () => {
  for (const when of [
    "input.未声明 == ''",
    "内容 == ''",
    "input.内容 > 7",
    "input.内容 == 7",
    "input.constructor == ''",
    "input.内容 == '' || true",
  ]) {
    const d = draft(echoSource);
    d.domain.前台.node.提问.route[0] = `IF ${when} go([非空:output], {内容:回应.数据.内容})`;
    assert.throws(() => parseWorld(sourceOf(d)));
  }
});

test("number comparisons select the first matching route and ignore output map order", () => {
  const d = draft(echoSource),
    n = d.domain.前台.node.提问;
  n.packet.问题.分数 = { type: "number" };
  d.domain.服务.node.回声.input = R("前台/提问/回声");
  n.route = [
    'IF input.分数 < 30 go([为空:output], {内容:""})',
    'go([非空:output], {内容:回应.数据.内容})',
  ];
  const world = parseWorld(sourceOf(d));
  for (const [score, expected] of [
    [15, "为空"],
    [30, "非空"],
    [92, "非空"],
  ] as const) {
    const input: Data = { 内容: "实际输入", 分数: score };
    const r = simulate(world, { node: echoStart.node, input });
    assert.equal(r.status, "completed", r.error);
    assert.equal(
      r.events.find((e) => e.node === echoStart.node && e.kind === "output")!
        .branch,
      expected,
    );
  }
  assert(compare(30, "<=", 30));
  assert(compare(31, ">", 30));
  assert(compare(30, ">=", 30));
  assert(compare("内容", "==", "内容"));
  assert(!compare(undefined, "!=", ""));
  assert(!compare("31", ">", 30));
});

test("old schema and independent LLM logic are rejected rather than normalized", () => {
  const changes: Array<(d: any) => void> = [
    (d) => {
      d.format = 1;
    },
    (d) => {
      d.format = 2;
    },
    (d) => {
      d.app = { id: "app", name: "旧格式", description: "" };
    },
    (d) => {
      d.entries = [];
    },
    (d) => {
      d.nodes = [];
    },
    (d) => {
      d.domain = Object.values(d.domain);
    },
    (d) => {
      d.domain.前台.frontend = {
        html: "<p>old</p>",
        entries: [],
        outputs: [],
      };
    },
    (d) => {
      d.domain.前台.node = Object.values(d.domain.前台.node);
    },
    (d) => {
      d.domain.前台.node.提问.branches = [];
    },
    (d) => {
      d.domain.前台.node.提问.router = { type: "if" };
    },
    (d) => {
      d.domain.前台.node.提问.inputName = "问题";
    },
    (d) => {
      d.domain.前台.node.提问.input = { $ref: "前台/提问/问题" };
    },
    (d) => {
      d.domain.前台.node.提问.packet.问题 = { $ref: "前台/提问/回声" };
    },
    (d) => {
      d.domain.前台.node.提问.logic = { type: "llm", ref: "model" };
    },
    (d) => {
      d.domain.前台.node.提问.output.非空.packetName = "回声";
    },
    (d) => {
      d.domain.前台.node.提问.output.非空.fields = {
        内容: { type: "text" },
      };
    },
    (d) => {
      d.domain.前台.node.提问.output.非空.reply = true;
    },
    (d) => {
      d.domain.前台.node.提问.output.非空.value = {内容: "旧赋值"};
    },
    (d) => {
      d.domain.服务.node.回声.output.完成.to = "caller";
    },
    (d) => {
      d.domain.前台.node.提问.route[0] = {if: {field: "input.内容", op: "ne", value: ""}, then: R('非空', 'output')};
    },
    (d) => {
      d.resource.记录.initial = [];
    },
    (d) => {
      d.resource = [{ id: "记录", fields: {} }];
    },
    (d) => {
      d.fable = {标题: {text: "旧寓言", scope: [R("前台", "domain")]}};
    },
  ];
  for (const change of changes) {
    const d = draft(echoSource);
    change(d);
    assert.throws(() => parseWorld(sourceOf(d)));
  }
  assert.throws(
    () => parseWorld("name: 一\nname: 二"),
    /Map keys must be unique/,
  );
  assert.throws(
    () => parseWorld(sourceOf(parseWorld(echoSource))),
    /expected record|Unrecognized key/,
  );
});
