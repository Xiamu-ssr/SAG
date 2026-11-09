import type { World } from "../core/model";
export type Point = { x: number; y: number };
export type ViewSizes = Record<string, { width: number; height: number }>;
export function mapLayout(world: World, sizes: ViewSizes = {}) {
  const cols = world.domains.length === 1 ? 1 : 2;
  const dimensions = world.domains.map((d) => {
    const view = d.type === "UI" ? sizes[d.id] || d.view : undefined;
    const count = world.nodes.filter((n) => n.domain === d.id).length;
    return view
      ? {
          width: Math.max(view.width + 80, count * 160 + 40),
          height: view.height + 150,
        }
      : { width: 390, height: 258 };
  });
  const widths = Array.from({ length: cols }, (_, col) =>
    Math.max(
      ...dimensions.filter((_, i) => i % cols === col).map((d) => d.width),
    ),
  );
  const heights = Array.from(
    { length: Math.ceil(dimensions.length / cols) },
    (_, row) =>
      Math.max(
        ...dimensions.slice(row * cols, (row + 1) * cols).map((d) => d.height),
      ),
  );
  const centers = new Map<string, Point>(),
    nodes = new Map<string, Point>();
  const bounds = new Map<string, { width: number; height: number }>();
  world.domains.forEach((d, i) => {
    const col = i % cols,
      row = Math.floor(i / cols),
      box = dimensions[i];
    const center = {
      x:
        40 +
        widths.slice(0, col).reduce((a, b) => a + b + 90, 0) +
        widths[col] / 2,
      y:
        30 +
        heights.slice(0, row).reduce((a, b) => a + b + 60, 0) +
        heights[row] / 2,
    };
    centers.set(d.id, center);
    bounds.set(d.id, box);
    const children = world.nodes.filter((n) => n.domain === d.id);
    children.forEach((n, j) => {
      const angle =
        -Math.PI / 2 + (j / Math.max(children.length, 1)) * Math.PI * 2;
      nodes.set(
        n.id,
        d.type === "UI" && d.view
          ? {
              x: center.x + (j - (children.length - 1) / 2) * 160,
              y: center.y + box.height / 2 - 36,
            }
          : {
              x: center.x + Math.cos(angle) * 127,
              y: center.y + Math.sin(angle) * 94,
            },
      );
    });
  });
  return {
    centers,
    nodes,
    bounds,
    width: widths.reduce((a, b) => a + b, 0) + (cols - 1) * 90 + 80,
    height: heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * 60 + 60,
  };
}
