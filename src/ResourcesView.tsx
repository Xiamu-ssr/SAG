import { useState } from "react";
import { Database } from "@phosphor-icons/react";
import type { Data, World } from "../core/model";
import { seconds } from "./api";
import { FieldList } from "./components";

export default function ResourcesView({
  world,
  initial,
  current,
  time,
}: {
  world: World;
  initial: Record<string, Data[]>;
  current: Record<string, Data[]> | null;
  time: number;
}) {
  const [view, setView] = useState<"initial" | "current">(current ? "current" : "initial");
  const data = view === "current" ? current : initial;
  return (
    <main className="detail-content">
      <div className="section-heading">
        <h2>数据</h2>
        <div className="segmented" aria-label="数据视角">
          <button
            aria-pressed={view === "initial"}
            onClick={() => setView("initial")}
          >
            初始数据
          </button>
          <button
            aria-pressed={view === "current"}
            onClick={() => setView("current")}
          >
            当前数据
          </button>
        </div>
      </div>
      <p className="data-time">
        {view === "current" && current
          ? `本次运行 · ${seconds(time)}`
          : "只读查看；初始数据以世界目录为准"}
      </p>
      {view === "current" && !current ? (
        <div className="empty-state">
          <Database size={34} />
          <p>尚未运行</p>
        </div>
      ) : !world.resources.length ? (
        <div className="empty-state">
          <Database size={34} />
          <p>还没有数据资源</p>
        </div>
      ) : (
        world.resources.map((r) => (
          <article className="resource-card" key={r.id}>
            <header>
              <h3>{r.name}</h3>
              <span>{data?.[r.id]?.length || 0} 条记录</span>
            </header>
            <FieldList fields={r.fields} />
            {data?.[r.id]?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(r.fields).map((key) => (
                        <th key={key}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data[r.id].map((row, index) => (
                      <tr key={index}>
                        {Object.keys(r.fields).map((key) => (
                          <td key={key}>
                            {typeof row[key] === "object"
                              ? JSON.stringify(row[key])
                              : String(row[key] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-records">暂无记录</p>
            )}
          </article>
        ))
      )}
    </main>
  );
}
