import { test } from "node:test";
import assert from "node:assert/strict";
import { zoomAt } from "../src/mapCamera";
test("wheel zoom preserves the world point beneath the cursor", () => {
  const a = { x: 130, y: 80, scale: 0.7 },
    cursor = { x: 355, y: 212 },
    b = zoomAt(a, 1.6, cursor);
  assert(
    Math.abs((cursor.x - a.x) / a.scale - (cursor.x - b.x) / b.scale) < 1e-9,
  );
  assert(
    Math.abs((cursor.y - a.y) / a.scale - (cursor.y - b.y) / b.scale) < 1e-9,
  );
  assert.deepEqual(a, { x: 130, y: 80, scale: 0.7 });
});
test("zoom bounds do not move the anchor or drift at the limit", () => {
  const a = { x: -90, y: 40, scale: 4 },
    anchor = { x: 200, y: 100 };
  assert.deepEqual(zoomAt(a, 2, anchor), a);
  assert.equal(zoomAt(a, 0.0001, anchor).scale, 0.15);
  assert.deepEqual(zoomAt(a, NaN, anchor), a);
});
