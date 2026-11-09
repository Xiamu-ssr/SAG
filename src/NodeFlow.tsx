import { useId, useMemo, useState } from "react";
import { ArrowUpRight, ArrowRight, ArrowUUpLeft, Package } from "@phosphor-icons/react";
import { stringify } from "yaml";
import {
  inputPacketId,
  outputPacketId,
  type Fields,
  type Node,
  type World,
} from "../core/model";
import type { Timeline } from "../core/engine";
import { logicIn } from "../core/logic";
import { fieldPath, type LogicStatement } from "../core/statements";
import { coordinateText } from '../core/coordinate';
import { FieldList } from "./components";
import { seconds } from "./api";
import { routeText, valueText } from "./routeLanguage";

type Part = "input" | "logic" | "route" | "output" | "packets";
const activityLabels = { call: "调用", reply: "回复调用方", resume: "收到回复", read: "读取" };
const actualValues = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
    ]),
  );

function PacketCoordinate({id}: {id: string}) {
  return <span className="packet-coordinate">
    <Package size={15} aria-hidden="true" />
    <code>{coordinateText(id, 'packet')}</code>
  </span>;
}

function PacketContract({id, fields, values, forwarded}: {
  id: string;
  fields: Fields;
  values?: Record<string, string>;
  forwarded?: string;
}) {
  const name = id.split('/').at(-1);
  return <section className="packet-contract" aria-label={`数据包 ${name}`}>
    <header>
      <strong>{name}</strong>
      <PacketCoordinate id={id} />
    </header>
    {forwarded && <p className="packet-forward">整包转交 <code>{forwarded}</code></p>}
    {Object.keys(fields).length
      ? <FieldList fields={fields} values={values} />
      : <p className="flow-empty">无字段</p>}
  </section>;
}

function LogicSteps({steps, world, onHighlight}: {
  steps: LogicStatement[];
  world: World;
  onHighlight: (id: string) => void;
}) {
  return <ol className="logic-calls">
    {steps.map((step, i) => {
      const callee = world.nodes.find(n => n.id === step.target) ?? world.services.find(service => service.id === step.target);
      const label = step.kind === 'call' ? `调用 ${callee?.name ?? step.target}` : `读取 ${step.target}`;
      return <li key={i}>
        <button title={step.target} onClick={() => onHighlight(step.target)}>
          <span className="logic-step">
            <strong>{label}<span> → {step.name}</span></strong>
            {step.kind === 'call' && step.packet && <PacketCoordinate id={step.packet} />}
            <code>{step.source}</code>
          </span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </li>;
    })}
  </ol>;
}

export default function NodeFlow({
  node,
  world,
  recording,
  time,
  onHighlight,
}: {
  node: Node;
  world: World;
  recording: Timeline | null;
  time: number;
  onHighlight: (id: string) => void;
}) {
  const [part, setPart] = useState<Part>("input"),
    [branchId, setBranchId] = useState<string>();
  const arrowId = useId();
  const input = recording?.events
    .filter((e) => e.node === node.id && e.kind === "enter" && e.time <= time)
    .at(-1);
  const observedBranch = recording?.events.filter(e => e.node === node.id && e.kind === 'output' && e.invocation === input?.invocation && e.time <= time).at(-1)?.branch;
  const branch = node.outputs.find(b => b.id === (branchId ?? observedBranch)) ?? node.outputs[0];
  const forwarded = branch && fieldPath(branch.values);
  const output = recording?.events
    .filter(
      (e) =>
        e.node === node.id &&
        e.kind === "output" &&
        e.branch === branch?.id &&
        e.invocation === input?.invocation &&
        e.time <= time,
    )
    .at(-1);
  const steps = useMemo(() => logicIn(node, node.logic), [node]);
  const packets = Object.entries(node.packets);
  const branchSteps = useMemo(() => logicIn(node, branch?.logic), [node, branch?.logic]);
  const routeYaml = useMemo(
    () => stringify({route: node.outputs.map(b => b.routeSource)}, {lineWidth: 0}),
    [node.outputs],
  );
  const activity = recording?.events.filter(
    (e) =>
      e.node === node.id &&
      e.invocation === input?.invocation &&
      e.time <= time &&
      Object.hasOwn(activityLabels, e.kind),
  );
  function showOutput(id: string) {
    setBranchId(id);
    setPart("output");
  }
  const circle = (
    id: Part,
    label: string,
    x: number,
    symbol: string,
    title = label,
  ) => (
    <g
      role="button"
      aria-label={label}
      tabIndex={0}
      aria-pressed={part === id}
      onClick={() => setPart(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setPart(id);
        }
      }}
      className={part === id ? "flow-dot active" : "flow-dot"}
    >
      <title>{title}</title>
      <circle cx={x} cy={30} r={19} />
      <text x={x} y={35} className="flow-symbol">
        {symbol}
      </text>
      <text x={x} y={72}>
        {label}
      </text>
    </g>
  );
  return (
    <div className="node-flow">
      <header className="node-flow-heading">
        <h2>{node.name}</h2>
        <button
          type="button"
          aria-pressed={part === "packets"}
          onClick={() => setPart(part === "packets" ? "input" : "packets")}
        >
          <Package size={16} aria-hidden="true" /> 数据包声明 · {packets.length}
        </button>
      </header>
      <svg
        className="flow-diagram"
        viewBox="0 0 320 84"
        aria-label="输入、共享逻辑区、IF 路由与分支"
      >
        <defs>
          <marker
            id={arrowId}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6" />
          </marker>
        </defs>
        {[28, 116, 204].map((x) => (
          <path
            className="flow-line"
            key={x}
            d={`M${x + 21},30 H${x + 65}`}
            markerEnd={`url(#${arrowId})`}
          />
        ))}
        {circle("input", "输入", 28, "↓", coordinateText(inputPacketId(node), 'packet'))}
        {circle(
          "logic",
          "共享逻辑区",
          116,
          "{}",
        )}
        {circle("route", "IF 路由", 204, "IF")}
        {circle(
          "output",
          "分支",
          292,
          "↑",
          [...new Set(node.outputs.map((b) => coordinateText(outputPacketId(node, b), 'packet')))].join("\n"),
        )}
      </svg>
      <section
        className="flow-content"
        aria-label={
          {
            input: "输入字段",
            logic: "共享逻辑区内容",
            route: "IF 路由条件",
            output: "输出分支",
            packets: "声明的数据包",
          }[part]
        }
      >
        {part === "packets" && (packets.length ? (
          <div className="packet-contracts">
            {packets.map(([name, fields]) => (
              <PacketContract key={name} id={`${node.id}/${name}`} fields={fields} />
            ))}
          </div>
        ) : <p className="flow-empty">本小域没有声明数据包</p>)}
        {part === "input" && (
          <PacketContract
            id={inputPacketId(node)}
            fields={node.input}
            values={input ? actualValues(input.data) : undefined}
          />
        )}
        {part === "logic" && (
          <>
            {steps.length ? (
              <LogicSteps steps={steps} world={world} onHighlight={onHighlight} />
            ) : (
              <p className="flow-empty">无逻辑步骤</p>
            )}
            {!!activity?.length && (
              <details className="logic-activity">
                <summary title="截至时间线当前位置，最近一次进入该小域的调用、读取和回复">
                  最近一次执行 · {activity.length} 条
                </summary>
                {activity.map((e) => (
                  <div
                    className="logic-event"
                    key={e.id}
                    title={
                      e.callId === undefined ? undefined : `调用 #${e.callId}`
                    }
                  >
                    <div className="logic-event-heading">
                      <time>{seconds(e.time)}</time>
                      <span>
                        {activityLabels[e.kind as keyof typeof activityLabels]}
                      </span>
                      {e.callName && <code>{e.callName}</code>}
                      {e.resource && <button onClick={() => onHighlight(e.resource!)}>{e.resource}<ArrowUpRight size={15} /></button>}
                      {e.target && (
                        <button onClick={() => onHighlight(e.target!)}>
                          {world.nodes.find((n) => n.id === e.target)?.name ??
                            world.services.find(service => service.id === e.target)?.name ?? e.target}
                          <ArrowUpRight size={15} />
                        </button>
                      )}
                    </div>
                    {!!Object.keys(e.data).length && (
                      <dl className="packet-fields">
                        {Object.entries(actualValues(e.data)).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{value}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    )}
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        {part === "route" && (
          <>
            <p className="route-caption">根据 IF 规则生成</p>
            <ol className="semantic-routes">
              {node.outputs.map((b, i) => (
                <li key={b.id}>
                  <button onClick={() => showOutput(b.id)}>
                    {routeText(node, i)}
                    <ArrowRight size={16} />
                  </button>
                </li>
              ))}
            </ol>
            <details className="route-source">
              <summary>查看 YAML</summary>
              <pre><code>{routeYaml}</code></pre>
            </details>
          </>
        )}
        {part === "output" && branch && (
          <>
            <div
              className="output-branches"
              role="group"
              aria-label="选择输出分支"
            >
              {node.outputs.map((b) => (
                <button
                  key={b.id}
                  title={coordinateText(outputPacketId(node, b), 'packet')}
                  aria-pressed={branch.id === b.id}
                  onClick={() => setBranchId(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {!!branchSteps.length && (
              <div className="branch-logic">
                <h3>「{branch.label}」分支的私有逻辑区</h3>
                <LogicSteps steps={branchSteps} world={world} onHighlight={onHighlight} />
              </div>
            )}
            <PacketContract
              id={outputPacketId(node, branch)}
              fields={branch.fields}
              forwarded={output ? undefined : forwarded}
              values={output
                ? actualValues(output.data)
                : forwarded ? undefined : Object.fromEntries(
                    Object.entries(branch.values).map(([key, value]) => [key, valueText(value, node.input)]),
                  )}
            />
            <div className="output-destinations">
              {branch.to.map((to) => (
                <button
                  key={to}
                  title={`高亮 ${to}`}
                  onClick={() => onHighlight(to)}
                >
                  <ArrowUpRight />
                  {world.nodes.find((n) => n.id === to)?.name || to}
                </button>
              ))}
              {branch.reply && (
                <span className="output-reply">
                  <ArrowUUpLeft />
                  回复调用方
                </span>
              )}
              {!branch.to.length && !branch.reply && <span>交付结束</span>}
            </div>
            {branch.write.map((w, i) => (
              <p className="business-write" key={i}>
                写入
                {world.resources.find((r) => r.id === w.resource)?.name ||
                  w.resource}
              </p>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
