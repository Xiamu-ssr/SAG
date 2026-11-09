import type { Recording } from "../core/engine";
import type { Data } from "../core/model";
export type InitialData = { data: Record<string, Data[]>; fingerprint: string };
export type Space = { id: string; name: string; created: string };
export type WorldSummary = {
  id: string;
  name: string;
  spaceId: string;
  builtin: boolean;
  directory: string;
  fingerprint: string;
  description: string;
  domainCount: number;
  nodeCount: number;
  fableCount: number;
  runCount: number;
  created: string;
  updated: string;
  error?: string;
};
export type WorldRow = Omit<
  WorldSummary,
  "description" | "domainCount" | "nodeCount" | "fableCount" | "runCount"
> & { source: string; assetBase: string };
export type RunSummary = {
  id: string;
  appId: string;
  entry: string;
  status: string;
  created: string;
  name?: string;
};
export type Run = {
  id: string;
  appId: string;
  source: string;
  fingerprint: string;
  assetBase: string;
  created: string;
  recording: Recording;
  saved: boolean;
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-SAG-Local": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data as T;
}
export function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const seconds = (value: number) => (value / 1000).toFixed(1) + "s";
