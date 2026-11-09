import { Container, Graphics, Text } from "pixi.js";
export function createPacketVisual(skin: {
  color: string;
  symbol: string;
  elongated: boolean;
}) {
  const view = new Container(),
    width = skin.elongated ? 36 : 18,
    height = 18,
    depth = 6,
    x = -width / 2,
    y = -height / 2;
  const color = parseInt(skin.color.slice(1), 16),
    edge = { color: 0xfdfdf7, width: 1 };
  const g = new Graphics()
    .ellipse(2, 14, width * 0.65, 5)
    .fill({ color: 0x314031, alpha: 0.16 });
  g.poly([
    x,
    y,
    x + depth,
    y - depth,
    x + width + depth,
    y - depth,
    x + width,
    y,
  ])
    .fill(color)
    .stroke(edge);
  g.poly([
    x + width,
    y,
    x + width + depth,
    y - depth,
    x + width + depth,
    y + height - depth,
    x + width,
    y + height,
  ])
    .fill(color)
    .stroke(edge);
  g.poly([
    x + width,
    y,
    x + width + depth,
    y - depth,
    x + width + depth,
    y + height - depth,
    x + width,
    y + height,
  ]).fill({ color: 0x000000, alpha: 0.2 });
  g.rect(x, y, width, height).fill(color).stroke(edge);
  const brightness =
    (color >> 16) * 0.299 +
    ((color >> 8) & 255) * 0.587 +
    (color & 255) * 0.114;
  const symbol = new Text({
    text: skin.symbol,
    style: {
      fontFamily: "Apple Symbols, Segoe UI Symbol, sans-serif",
      fontSize: 14,
      fill: brightness > 165 ? 0x25362e : 0xffffff,
    },
  });
  symbol.anchor.set(0.5);
  symbol.position.set(0, 0);
  view.addChild(g, symbol);
  view.eventMode = "none";
  return view;
}
