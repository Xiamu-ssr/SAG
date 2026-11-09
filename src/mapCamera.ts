export type Camera = { x: number; y: number; scale: number };
export function zoomAt(
  camera: Camera,
  factor: number,
  anchor: { x: number; y: number },
): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  const scale = Math.max(0.15, Math.min(4, camera.scale * factor)),
    ratio = scale / camera.scale;
  return {
    x: anchor.x + (camera.x - anchor.x) * ratio,
    y: anchor.y + (camera.y - anchor.y) * ratio,
    scale,
  };
}
