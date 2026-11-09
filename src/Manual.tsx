import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, BookOpen, Browser, Check, Code, Copy, Cube, Database,
  DownloadSimple, FileCode, FilmStrip, FlowArrow, FolderSimple, GitBranch,
  MapTrifold, Package, Path, Planet, Plugs, Scroll, SignIn, SignOut, SquaresFour, ArrowRight, GitFork,
  type Icon,
} from "@phosphor-icons/react";
import markdown from "../docs/manual.md?raw";
import builtinWorld from "../examples/photo-recognition/world.yaml?raw";
import sagSkill from "../skills/sag/SKILL.md?raw";
import { packetColors, packetSymbols } from "../core/packets";
import { download } from "./api";
import { Brand } from "./components";
import { manualInline, parseManual, type ManualBlock, type ManualHeading } from "./manualMarkdown";

const source = markdown.replace("{{WORLD_YAML}}", () => builtinWorld.trimEnd())
  .replace("{{SAG_SKILL}}", () => sagSkill.trimEnd());
const blocks = parseManual(source);
const chapters = blocks.filter((block): block is ManualHeading => block.kind === "heading" && block.level === 2);
const chapterIcons: Record<string, Icon> = {
  添加世界: FolderSimple, 数据包: Package, 大域与道路: SquaresFour, 小域: FlowArrow, 坐标: MapTrifold,
  关键字: Code, 前台: Browser, 外部服务: Plugs, 数据资源: Database, 寓言: Scroll, 运行与留影: FilmStrip, SKILL: FileCode,
};
const chapterTitle = (text: string) => text.replace(/^\d+ · /, "");
const termIcons: Record<string, Icon> = {
  大域: SquaresFour, 小域: Cube, 输入: SignIn, 共享逻辑: Code, 外部服务: Plugs,
  "IF 路由": GitBranch, 输出: SignOut, 数据包: Package,
  数据资源: Database, 寓言: Scroll, 留影: FilmStrip, 道路: Path,
};

const conceptChapter: Record<string, string> = {domain: "大域与道路", node: "小域", packet: "数据包", resource: "数据资源", service: "外部服务", fable: "寓言", recording: "运行与留影"};
function Concepts({rows, go}: {rows: string[][]; go: (id: string) => void}) {
  const open = (title: string) => {
    const chapter = chapters.find(chapter => chapterTitle(chapter.text) === title);
    if (chapter) go(chapter.id);
  };
  return <div className="manual-concepts" aria-label="世界组成">
    {rows.map(([term, code, meaning]) => {
      const Icon = termIcons[term] || BookOpen;
      return <section key={code} className={`concept concept-${code}`}>
        <button className="concept-title" onClick={() => open(conceptChapter[code])}><Icon size={25} weight="duotone" /><strong>{term}</strong><code>{code}</code></button>
        {code === 'node' ? <div className="concept-node-parts">{[[SignIn,'输入','input'],[Code,'共享逻辑','logic'],[GitBranch,'IF','route'],[SignOut,'分支','output']].map(([Part, label, key]) => {
          const PartIcon = Part as Icon;
          return <button key={String(key)} onClick={() => open("小域")}><PartIcon size={18} /><span>{String(label)}</span><code>{String(key)}</code></button>;
        })}</div> : <p>{meaning}</p>}
        {code === 'domain' && <button className="concept-road" onClick={() => open("大域与道路")}><Path size={18} />道路<code>road</code></button>}
      </section>;
    })}
  </div>;
}

function Diagram({kind}: {kind: string}) {
  if (kind.trim() === 'packet-palette') return (
    <details className="manual-palette">
      <summary>查看星座与颜色</summary>
      <div className="palette-symbols" aria-label="星座">
        {packetSymbols.map(symbol => <span key={symbol}>{symbol}</span>)}
      </div>
      <div className="palette-colors" role="list" aria-label="颜色">
        {packetColors.map(color => <span key={color} role="listitem" aria-label={color} title={color} style={{background: color}} />)}
      </div>
    </details>
  );
  if (kind.trim() === 'domain') return <div className="manual-domain-diagram" aria-label="前台与 ant服务器大域之间的道路">
    <span><Browser size={25} />前台<code>domain</code></span><i aria-label="道路" /><span><SquaresFour size={25} />ant服务器<code>domain</code></span>
  </div>;
  return <div className="manual-node-diagram" aria-label="输入进入共享逻辑，再由 IF 选择分支">
    <div><SignIn /><strong>输入</strong><code>input</code></div><ArrowRight className="diagram-arrow" />
    <div><Code /><strong>共享逻辑</strong><code>logic</code></div><ArrowRight className="diagram-arrow" />
    <div><GitBranch /><strong>IF</strong><code>route</code></div><GitFork className="diagram-arrow" />
    <section><span><SignOut />安全<code>output</code></span><span><SignOut />未识别<code>output</code></span><span><SignOut />正常<code>output</code></span></section>
  </div>;
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState("");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailure("");
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailure("复制不可用，请使用页面顶部下载。");
    }
  }
  return (
    <div className="manual-code">
      <div className="manual-code-heading">
        <span>{language || "text"}</span>
        <button onClick={() => void copy()} aria-label="复制代码">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          <span role="status">{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre tabIndex={0}><code>{text}</code></pre>
      {failure && <p className="manual-copy-error" role="status">{failure}</p>}
    </div>
  );
}

function Block({ block, go }: { block: ManualBlock; go: (id: string) => void }) {
  switch (block.kind) {
    case "heading": {
      const Heading = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
      const ChapterIcon = chapterIcons[chapterTitle(block.text)] || BookOpen;
      return (
        <Heading id={block.id} tabIndex={-1}>
          {block.level === 1 && <span className="manual-title-mark"><Planet size={34} weight="duotone" aria-hidden="true" /></span>}
          {block.level === 2 && <ChapterIcon className="manual-chapter-icon" size={23} weight="duotone" aria-hidden="true" />}
          <span>{manualInline(block.text)}</span>
        </Heading>
      );
    }
    case "code": return block.language === 'diagram' ? <Diagram kind={block.text} /> : <CodeBlock language={block.language} text={block.text} />;
    case "paragraph": return <p>{manualInline(block.text)}</p>;
    case "quote": return <blockquote>{manualInline(block.text)}</blockquote>;
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return <List>{block.items.map((item, i) => <li key={i}>{manualInline(item)}</li>)}</List>;
    }
    case "table": {
      if (block.header[0] === "术语" && block.header[1] === "源码") return (
        <Concepts rows={block.rows} go={go} />
      );
      return (
      <div className="manual-table" role="region" aria-label={block.header.join("、")} tabIndex={0}>
        <table>
          <thead><tr>{block.header.map((cell, i) => <th key={i} scope="col">{manualInline(cell)}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{manualInline(cell)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      );
    }
  }
}

export default function Manual() {
  const [active, setActive] = useState(chapters[0]?.id || "");
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    const headings = Array.from(article.current?.querySelectorAll("h2") || []);
    let frame = 0;
    const update = () => {
      let current = headings[0];
      const boundary = current ? parseFloat(getComputedStyle(current).scrollMarginTop) + 8 : 140;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > boundary) break;
        current = heading;
      }
      if (current) setActive(current.id);
      frame = 0;
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", scroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  function go(id: string) {
    const heading = document.getElementById(id);
    heading?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
    setActive(id);
  }
  return (
    <div className="manual-page">
      <a className="manual-skip" href="#/manual" onClick={(event) => { event.preventDefault(); article.current?.focus(); }}>跳到正文</a>
      <header className="home-header">
        <Brand />
        <nav aria-label="首页导航">
          <a href="#/">首页</a>
          <a href="#/manual" aria-current="page">说明书</a>
        </nav>
        <div className="manual-downloads">
          <button className="outline-button" onClick={() => download("world.yaml", builtinWorld)}><FileCode size={17} />示例 YAML</button>
          <button className="outline-button" onClick={() => download("sag-manual.md", source)}><DownloadSimple size={17} />Markdown</button>
        </div>
      </header>
      <main className="manual-layout">
        <aside className="manual-sidebar">
          <div className="manual-index-title"><BookOpen size={18} />使用说明</div>
          <nav aria-label="说明书章节">
            {chapters.map((chapter) => {
              const ChapterIcon = chapterIcons[chapterTitle(chapter.text)] || BookOpen;
              return <button key={chapter.id} aria-current={active === chapter.id ? "location" : undefined} onClick={() => go(chapter.id)}>
                <ChapterIcon size={18} weight="duotone" aria-hidden="true" />{chapter.text}
              </button>;
            })}
          </nav>
          <a className="manual-back" href="#/"><ArrowLeft size={15} />返回空间与世界</a>
        </aside>
        <article className="manual-content" ref={article} tabIndex={-1} aria-label="SAG 说明书正文">
          {blocks.map((block, i) => <Block key={i} block={block} go={go} />)}
        </article>
      </main>
    </div>
  );
}
