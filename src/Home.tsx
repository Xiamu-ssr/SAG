import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Cube,
  FilmStrip,
  FolderOpen,
  FolderSimple,
  LockSimple,
  Plus,
  Scroll,
  SquaresFour,
} from "@phosphor-icons/react";
import { api, type Space, type WorldSummary } from "./api";
import { Brand, ErrorMessage, Modal } from "./components";

function WorldCard({ world }: { world: WorldSummary }) {
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState("");
  async function openDirectory() {
    setOpening(true);
    setFailure("");
    try {
      await api(`/apps/${encodeURIComponent(world.id)}/open-directory`, "POST");
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  }
  const content = (
    <>
      <div className="world-cover">
        <img src="/assets/domain-hub.png" alt="" />
        {world.builtin && (
          <span className="builtin-badge" title="内置示例">
            <LockSimple size={13} />内置示例
          </span>
        )}
      </div>
      <div className="world-card-body">
        <h3>{world.name}</h3>
        <p>{world.description || "本地目录中的世界"}</p>
        {world.error && <p className="world-card-error" role="alert">{world.error}</p>}
        <div className="world-card-meta">
          <span><SquaresFour />{world.domainCount} 个大域</span>
          <span><Cube />{world.nodeCount} 个小域</span>
          <span><Scroll />{world.fableCount} 寓言</span>
          {world.runCount > 0 && <span><FilmStrip />{world.runCount} 份留影</span>}
        </div>
      </div>
    </>
  );
  return (
    <article className={`world-card${world.error ? " world-card-invalid" : ""}`}>
      {world.error ? (
        <div className="world-card-link">{content}</div>
      ) : (
        <a className="world-card-link" href={`#/world/${world.id}`}>{content}</a>
      )}
      <div className="world-card-folder">
        <button onClick={() => void openDirectory()} disabled={opening} title={world.directory} aria-label={`打开 ${world.name} 的文件夹`}>
          <FolderOpen size={17} />{opening ? "打开中…" : "打开文件夹"}
        </button>
      </div>
      {failure && <div className="world-folder-error"><ErrorMessage message={failure} /></div>}
    </article>
  );
}

export default function Home({
  spaces,
  worlds,
  refresh,
  error,
  loading,
  chosenSpace,
  setChosenSpace,
}: {
  spaces: Space[];
  worlds: WorldSummary[];
  refresh: () => Promise<void>;
  error: string;
  loading: boolean;
  chosenSpace: string;
  setChosenSpace: (id: string) => void;
}) {
  const [creating, setCreating] = useState<"space" | "world" | null>(null);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState("");
  const spaceId = spaces.some((space) => space.id === chosenSpace)
    ? chosenSpace
    : spaces[0]?.id;
  const visibleWorlds = worlds.filter((world) => world.spaceId === spaceId);
  function open(kind: "space" | "world") {
    setCreating(kind);
    setName("");
    setDirectory("");
    setFailure("");
  }
  async function pickDirectory() {
    setPicking(true);
    setFailure("");
    try {
      const result = await api<{ directory: string | null }>("/pick-directory", "POST");
      if (result.directory) setDirectory(result.directory);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPicking(false);
    }
  }
  async function create() {
    if (saving || picking) return;
    setSaving(true);
    setFailure("");
    try {
      if (creating === "space") {
        const space = await api<Space>("/spaces", "POST", { name: name.trim() });
        await refresh();
        setChosenSpace(space.id);
      } else {
        await api("/apps", "POST", { directory: directory.trim(), spaceId });
        await refresh();
      }
      setCreating(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="home-page">
      <header className="home-header">
        <Brand />
        <nav aria-label="首页导航">
          <a href="#/" aria-current="page">首页</a>
          <a href="#/manual">说明书</a>
        </nav>
        <button className="outline-button" onClick={() => open("space")}><Plus />新建空间</button>
      </header>
      <main className="home-main">
        <section className="home-brief" aria-label="SAG 简介">
          <h1>让业务成为一个可运行的世界。</h1>
          <a href="#/manual"><BookOpen size={18} />阅读说明书<ArrowRight size={16} /></a>
        </section>
        <section className="spaces-section" id="spaces">
          <div className="section-heading">
            <h2>空间</h2>
            <button className="primary" disabled={!spaceId || loading} onClick={() => open("world")}>
              <Plus size={18} />添加世界
            </button>
          </div>
          <div className="space-tabs" role="tablist" aria-label="空间">
            {spaces.map((space) => (
              <button role="tab" aria-selected={space.id === spaceId} key={space.id} onClick={() => setChosenSpace(space.id)}>
                <FolderSimple weight={space.id === spaceId ? "fill" : "regular"} />{space.name}
              </button>
            ))}
          </div>
          <ErrorMessage message={error} />
          {loading ? (
            <div className="empty-state" role="status">正在读取空间…</div>
          ) : (
            <div className="world-grid">
              {visibleWorlds.map((world) => <WorldCard key={world.id} world={world} />)}
              <button className="new-world-card" disabled={!spaceId} onClick={() => open("world")}>
                <span><Plus size={26} /></span>添加世界
              </button>
            </div>
          )}
        </section>
      </main>
      {creating && (
        <Modal title={creating === "space" ? "新建空间" : "添加世界"} onClose={() => {
          if (!saving && !picking) setCreating(null);
        }} className="create-modal">
          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
            {creating === "space" ? (
              <label>空间名称
                <input autoFocus required maxLength={80} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>
            ) : (
              <>
                <label htmlFor="world-directory">本地世界目录</label>
                <div className="world-directory-picker">
                  <input id="world-directory" autoFocus required value={directory} disabled={saving || picking} placeholder="/Users/你/我的世界" onChange={(event) => setDirectory(event.target.value)} />
                  <button type="button" className="outline-button" disabled={saving || picking} onClick={() => void pickDirectory()}>
                    <FolderOpen size={17} />{picking ? "选择中…" : "选择文件夹"}
                  </button>
                </div>
                <p className="directory-note">目录包含 world.yaml、frontend/index.html 和 initial.sqlite。世界名称读取自 world.yaml，添加只登记目录，不创建或复制模板。</p>
              </>
            )}
            <ErrorMessage message={failure} />
            <button type="submit" className="primary" disabled={saving || picking || !(creating === "space" ? name.trim() : directory.trim())}>
              {saving ? "校验并保存中…" : creating === "space" ? "创建空间" : "添加世界"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
