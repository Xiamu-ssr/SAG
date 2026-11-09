import type { World } from "./model";
import { logicIn } from "./logic";

export type Road = { id: string; from: string; to: string };

export function roadsFor(world: World): Road[] {
  const nodes = new Map(world.nodes.map((node) => [node.id, node]));
  const roads = new Map<string, Road>();
  for (const node of world.nodes)
    for (const target of [
      ...node.outputs.flatMap((b) => b.to),
      ...[...logicIn(node, node.logic), ...node.outputs.flatMap(output => logicIn(node, output.logic))]
        .filter(step => step.kind === "call").map(step => step.target),
    ]) {
      const next = nodes.get(target);
      if (!next || node.domain === next.domain) continue;
      const [from, to] = [node.domain, next.domain].sort();
      const id = `road:${from}|${to}`;
      roads.set(id, { id, from, to });
    }
  return [...roads.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

export function fablesFor(world: World, subjectId: string): World["fables"] {
  const subjects = new Set([subjectId]);
  for (const node of world.nodes)
    if (node.domain === subjectId || node.id === subjectId) {
      subjects.add(node.id);
      for (const packet of Object.keys(node.packets))
        subjects.add(`${node.id}/${packet}`);
      subjects.add(node.inputPacket);
      for (const output of node.outputs) {
        subjects.add(output.packet);
        subjects.add(`${node.id}/${output.id}`);
      }
    }
  return world.fables.filter(fable => subjects.has(fable.target));
}
