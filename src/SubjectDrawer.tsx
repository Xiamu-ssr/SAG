import { useState } from "react";
import { BookOpen, X } from "@phosphor-icons/react";
import type { World, Data } from "../core/model";
import type { Timeline } from "../core/engine";
import { fablesFor, roadsFor } from "../core/topology";
import { packetAppearance } from "../core/packets";
import { FieldList } from "./components";
import { seconds } from "./api";
import NodeFlow from "./NodeFlow";
export function Packet({ data }: { data: Data }) {
  return (
    <dl className="packet-fields">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function subjectName(world: World, id: string) {
  return (
    world.nodes.find((n) => n.id === id)?.name ||
    world.domains.find((d) => d.id === id)?.name ||
    world.resources.find((r) => r.id === id)?.name ||
    world.services.find((service) => service.id === id)?.name ||
    (roadsFor(world).some((r) => r.id === id) ? "道路" : id)
  );
}
export default function SubjectDrawer({
  world,
  selected,
  recording,
  time,
  onHighlight,
  onClose,
}: {
  world: World;
  selected: string;
  recording: Timeline | null;
  time: number;
  onHighlight: (id: string) => void;
  onClose: () => void;
}) {
  const node = world.nodes.find((n) => n.id === selected),
    domain = world.domains.find((d) => d.id === selected),
    road = roadsFor(world).find((r) => r.id === selected),
    resource = world.resources.find((r) => r.id === selected),
    service = world.services.find((item) => item.id === selected),
    fables = fablesFor(world, selected);
  return (
    <aside
      className={`subject-drawer ${node ? "node-drawer" : ""}`}
      aria-label="主体详情"
    >
      {node ? (
        <button
          className="drawer-close"
          title="关闭详情"
          aria-label="关闭详情"
          onClick={onClose}
        >
          <X />
        </button>
      ) : (
        <header className="drawer-heading">
          <h2>{subjectName(world, selected)}</h2>
          <button title="关闭详情" aria-label="关闭详情" onClick={onClose}>
            <X />
          </button>
        </header>
      )}
      <div className="drawer-body" key={selected}>
        {node ? (
          <NodeFlow
            node={node}
            world={world}
            recording={recording}
            time={time}
            onHighlight={onHighlight}
          />
        ) : (
          <>
            {domain?.description && (
              <p className="node-description">{domain.description}</p>
            )}
            {domain?.notes && (
              typeof domain.notes === "string"
                ? <p className="domain-notes">{domain.notes}</p>
                : <ul className="domain-notes">
                    {domain.notes.map((note, i) => <li key={i}>{note}</li>)}
                  </ul>
            )}
            {resource && <FieldList fields={resource.fields} />}{" "}
            {service && (
              <div className="service-contract">
                {service.description && <p>{service.description}</p>}
                <code>{service.script}</code>
                <section><h3>输入</h3><FieldList fields={service.input} /></section>
                <section><h3>输出</h3><FieldList fields={service.output} /></section>
              </div>
            )}
            {road && (
              <RoadHistory world={world} recording={recording} road={road} />
            )}
          </>
        )}
        {!!fables.length && (
          <details className="related-fables">
            <summary>
              <BookOpen />
              寓言 · {fables.length}
            </summary>
            {fables.map((f, i) => (
              <p key={i}>{f.text}</p>
            ))}
          </details>
        )}
      </div>
    </aside>
  );
}
function RoadHistory({
  world,
  recording,
  road,
}: {
  world: World;
  recording: Timeline | null;
  road: { from: string; to: string };
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const domainOf = (id: string) => world.nodes.find((n) => n.id === id)?.domain;
  const matches = (filter: string, id: string) =>
    !filter || filter === id || filter === domainOf(id);
  const events =
    recording?.events.filter(
      (e) =>
        e.kind === "transfer" &&
        e.target &&
        [domainOf(e.node), domainOf(e.target)].sort().join("|") ===
          [road.from, road.to].sort().join("|") &&
        matches(from, e.node) &&
        matches(to, e.target),
    ) || [];
  const options = (
    <>
      <option value="">全部</option>
      {[road.from, road.to].map((id) => (
        <optgroup key={id} label={subjectName(world, id)}>
          <option value={id}>{subjectName(world, id)} · 全域</option>
          {world.nodes
            .filter((n) => n.domain === id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
  return (
    <section className="road-history">
      <h3>
        {subjectName(world, road.from)} ↔ {subjectName(world, road.to)}
      </h3>
      <div className="road-filters">
        <label>
          起点
          <select
            aria-label="道路起点"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {options}
          </select>
        </label>
        <label>
          终点
          <select
            aria-label="道路终点"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {options}
          </select>
        </label>
      </div>
      <h3>数据包 · {events.length}</h3>
      {!events.length && (
        <p className="empty-records">
          {recording ? "没有匹配的数据包" : "运行后查看数据包"}
        </p>
      )}
      {events.map((e) => {
        const skin = packetAppearance(e);
        return (
          <details className="packet-card" key={e.id}>
            <summary>
              <span
                className={`packet-mark ${skin.elongated ? "multi" : ""}`}
                style={{ background: skin.color }}
              >
                {skin.symbol}
              </span>
              <time>{seconds(e.time)}</time>
              <span>
                {subjectName(world, e.node)} → {subjectName(world, e.target!)}
              </span>
              {e.direction && (
                <span className="packet-direction">
                  {e.callName && `${e.callName} · `}
                  {{ call: "调用", reply: "回复", send: "发送", read: "读取", write: "写入" }[e.direction]}
                </span>
              )}
            </summary>
            <Packet data={e.data} />
          </details>
        );
      })}
    </section>
  );
}
