import { memo, useEffect, useState } from "react";
import { FileText } from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { ErrorMessage } from "./components";
import "./documents.css";

function relativePath(from: string, link?: string) {
  if (!link || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(link)) return;
  const origin = "https://docs.invalid";
  try {
    const url = new URL(link, origin + "/" + from.split("/").map(encodeURIComponent).join("/"));
    if (url.origin === origin) return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return;
  }
}

export default memo(function DocumentsView({worldId}: {worldId: string}) {
  const endpoint = `/apps/${encodeURIComponent(worldId)}/documents`;
  const [files, setFiles] = useState<string[] | null>(null);
  const [selected, setSelected] = useState("");
  const [document, setDocument] = useState<{path: string; source: string}>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{files: string[]}>(endpoint).then(result => {
      if (!active) return;
      setFiles(result.files);
      setSelected(result.files.find(path => /^readme\.(md|markdown|txt)$/i.test(path)) ?? result.files[0] ?? "");
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [endpoint]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setError("");
    api<{source: string}>(endpoint + "?path=" + encodeURIComponent(selected)).then(result => {
      if (active) setDocument({path: selected, source: result.source});
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [endpoint, selected]);

  const source = document?.path === selected ? document.source : undefined;
  return (
    <main className="world-documents">
      <aside aria-label="文档列表" className="document-list">
        <header><h2>文档</h2><code>docs/</code></header>
        {files?.map(path => {
          const slash = path.lastIndexOf("/");
          return <button key={path} title={path} aria-current={path === selected ? "page" : undefined}
            onClick={() => setSelected(path)}>
            <FileText size={17} aria-hidden="true" />
            <span>
              <strong>{path.slice(slash + 1)}</strong>
              {slash >= 0 && <small>{path.slice(0, slash)}</small>}
            </span>
          </button>;
        })}
      </aside>
      <div key={selected} className="document-pane" aria-label="文档内容">
        <ErrorMessage message={error} />
        {!error && (
          files?.length === 0 ? (
            <div className="empty-state"><FileText size={36} /><p>把迁移资料或暂时写不进规则的细节放在 docs/。</p></div>
          ) : source === undefined ? (
            <p className="document-status">正在读取…</p>
          ) : (
            <article className="world-document">
              <p className="document-path">{selected}</p>
              {/\.txt$/i.test(selected) ? <pre>{source}</pre> : (
                <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
                  a: ({href, children}) => {
                    const path = relativePath(selected, href);
                    if (path && files?.includes(path)) {
                      return <button className="document-link" onClick={() => setSelected(path)}>{children}</button>;
                    }
                    if (href && /^https?:\/\//i.test(href)) {
                      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                    }
                    return <>{children}</>;
                  },
                  img: ({src, alt}) => {
                    const path = typeof src === "string" ? relativePath(selected, src) : undefined;
                    if (path) return <img src={"/api" + endpoint + "/image?path=" + encodeURIComponent(path)} alt={alt ?? ""} loading="lazy" />;
                    if (typeof src === "string" && /^https?:\/\//i.test(src)) {
                      return <a href={src} target="_blank" rel="noreferrer">{alt || "打开外部图片"}</a>;
                    }
                    return <>{alt}</>;
                  },
                }}>{source}</Markdown>
              )}
            </article>
          )
        )}
      </div>
    </main>
  );
});
