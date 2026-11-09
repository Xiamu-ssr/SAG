import { Fragment, type ReactNode } from "react";

export type ManualHeading = {
  kind: "heading";
  level: 1 | 2 | 3;
  text: string;
  id: string;
};

export type ManualBlock =
  | ManualHeading
  | { kind: "paragraph" | "quote"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] };

// Deliberately limited to the Markdown used by the manual. Raw HTML stays text.
export function parseManual(source: string): ManualBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ManualBlock[] = [];
  const cells = (line: string) =>
    line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const list = /^(?:[-*] |\d+\. )/;
  const startsBlock = (line: string) =>
    /^(?:#{1,3} |```|> |\|)/.test(line) || list.test(line);
  let chapter = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length as ManualHeading["level"];
      blocks.push({
        kind: "heading",
        level,
        text: heading[2],
        id: level === 2 ? `chapter-${++chapter}` : `heading-${i}`,
      });
      i++;
    } else if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++)
        code.push(lines[i]);
      blocks.push({ kind: "code", language, text: code.join("\n") });
      if (i < lines.length) i++;
    } else if (
      line.startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[i + 1] || "")
    ) {
      const header = cells(line), rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].startsWith("|"); i++)
        rows.push(cells(lines[i]));
      blocks.push({ kind: "table", header, rows });
    } else if (list.test(line)) {
      const ordered = /^\d/.test(line), items: string[] = [];
      while (
        i < lines.length && list.test(lines[i]) && /^\d/.test(lines[i]) === ordered
      ) items.push(lines[i++].replace(list, ""));
      blocks.push({ kind: "list", ordered, items });
    } else if (line.startsWith("> ")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith("> "))
        parts.push(lines[i++].slice(2));
      blocks.push({ kind: "quote", text: parts.join(" ") });
    } else {
      const parts = [line];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++)
        parts.push(lines[i]);
      blocks.push({ kind: "paragraph", text: parts.join(" ") });
    }
  }
  return blocks;
}

export function manualInline(source: string): ReactNode[] {
  const tokens = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of source.matchAll(tokens)) {
    if (match.index > cursor) result.push(source.slice(cursor, match.index));
    const key = match.index;
    if (match[1]) result.push(<code key={key}>{match[1]}</code>);
    else if (match[2])
      result.push(<strong key={key}>{manualInline(match[2])}</strong>);
    else if (/^https?:\/\//i.test(match[4]))
      result.push(
        <a key={key} href={match[4]} target="_blank" rel="noreferrer">
          {match[3]}
        </a>,
      );
    else result.push(<Fragment key={key}>{match[3]}</Fragment>);
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) result.push(source.slice(cursor));
  return result;
}
