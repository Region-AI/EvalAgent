export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export type MappingMeta = {
  capture: Size & { originX: number; originY: number };
  analysis?: Size; // dimensions of the image as seen by the model
  normalized?: boolean; // if incoming coords are normalized to analysis dims
  stretch?: boolean; // true when analysis image is a stretched resize of capture
  // Optional explicit padding if backend uses non-centered letterboxing
  padding?: { left: number; top: number };
};

export function makeImageToScreenMapper(meta: MappingMeta) {
  const Cw = meta.capture.width;
  const Ch = meta.capture.height;
  const Cx0 = meta.capture.originX ?? 0;
  const Cy0 = meta.capture.originY ?? 0;

  const Aw = meta.analysis?.width ?? Cw;
  const Ah = meta.analysis?.height ?? Ch;

  const stretch = meta.stretch === true;
  const r = stretch ? 1 : Math.min(Aw / Cw, Ah / Ch);
  const contentW = stretch ? Aw : Cw * r;
  const contentH = stretch ? Ah : Ch * r;
  const padLeft = stretch
    ? 0
    : meta.padding?.left ?? Math.max(0, (Aw - contentW) / 2);
  const padTop = stretch
    ? 0
    : meta.padding?.top ?? Math.max(0, (Ah - contentH) / 2);

  function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
  }

  function toScreenPoint(p: Point): Point {
    let ax = p.x;
    let ay = p.y;
    if (meta.normalized) {
      ax = ax * Aw;
      ay = ay * Ah;
    }
    const sx = stretch
      ? Cx0 + Math.round((ax * Cw) / Aw)
      : Cx0 + Math.round((ax - padLeft) / r);
    const sy = stretch
      ? Cy0 + Math.round((ay * Ch) / Ah)
      : Cy0 + Math.round((ay - padTop) / r);
    return {
      x: clamp(sx, Cx0, Cx0 + Cw - 1),
      y: clamp(sy, Cy0, Cy0 + Ch - 1),
    };
  }

  function toScreenBox(b: Box): Box {
    const p1 = toScreenPoint({ x: b.x, y: b.y });
    const p2 = toScreenPoint({ x: b.x + b.width, y: b.y + b.height });
    return {
      x: p1.x,
      y: p1.y,
      width: Math.max(1, p2.x - p1.x),
      height: Math.max(1, p2.y - p1.y),
    };
  }

  return { toScreenPoint, toScreenBox, scale: r, padLeft, padTop };
}
