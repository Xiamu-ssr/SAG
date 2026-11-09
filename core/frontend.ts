import { checkData, applyDefaults, type Data, type World } from "./model";
import { reference, coordinateText } from './coordinate';
import type { Timeline, Start } from "./engine";

export function frontendInput(
  world: World,
  domainId: string,
  nodeId: string,
  values: unknown,
): Start {
  const domain = world.domains.find((d) => d.id === domainId);
  let id: string;
  try { id = reference(nodeId, 'node'); }
  catch { throw new Error('未声明的本域 UI 小域；请使用 [大域:domain/小域:node]'); }
  const node = world.nodes.find((n) => n.id === id);
  if (domain?.type !== "UI" || !node || node.domain !== domainId)
    throw new Error("未声明的本域 UI 小域");
  const input = applyDefaults(values, node.input);
  checkData(input, node.input, node.id);
  return { node: node.id, input, name: node.name };
}

export function frontendOutputs(
  world: World,
  domainId: string,
  recording: Timeline | null,
  time: number,
) {
  const allowed = new Set(
    world.domains.some((d) => d.id === domainId && d.type === "UI")
      ? world.nodes.filter((n) => n.domain === domainId).map((n) => n.id)
      : [],
  );
  const result: Record<string, { branch: string; data: Data }> = {};
  for (const event of recording?.events || [])
    if (
      event.kind === "output" &&
      event.time <= time &&
      allowed.has(event.node)
    )
      result[coordinateText(event.node, 'node')] = {
        branch: event.branch || "",
        data: structuredClone(event.data),
      };
  return result;
}
