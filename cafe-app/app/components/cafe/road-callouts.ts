type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };
type RoadAnchor = { point: Point; angle: number };

export const roadBadgeSize = 17;
const halfBadge = roadBadgeSize / 2;
const firstRadius = halfBadge + 9;
const clearance = 3;
const directions = [0, 1, -1, 2, -2, 3, -3, 4];
const radii = [firstRadius, 25, 35, 48, 64];

function atRadius(angle: number, radius: number): Point {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function preferredRoadOffset(angle: number): Point {
  return atRadius(angle, firstRadius);
}

function around({ x, y }: Point, radius: number): Box {
  return {
    left: x - radius,
    right: x + radius,
    top: y - radius,
    bottom: y + radius,
  };
}

function contains(box: Box, { x, y }: Point) {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

function crosses(from: Point, to: Point, box: Box): boolean {
  if (contains(box, from) || contains(box, to)) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (
    (dx !== 0 &&
      [box.left, box.right].some((x) => {
        const t = (x - from.x) / dx;
        const y = from.y + dy * t;
        return t > 0 && t < 1 && y >= box.top && y <= box.bottom;
      })) ||
    (dy !== 0 &&
      [box.top, box.bottom].some((y) => {
        const t = (y - from.y) / dy;
        const x = from.x + dx * t;
        return t > 0 && t < 1 && x >= box.left && x <= box.right;
      }))
  );
}

export function placeRoadCallouts(
  anchors: RoadAnchor[],
  bounds: { width: number; height: number },
  obstacles: Box[],
): (Point | null)[] {
  const margin = halfBadge + clearance;
  const frame = {
    left: margin,
    top: margin,
    right: bounds.width - margin,
    bottom: bounds.height - margin,
  };
  const taken: Box[] = [];

  return anchors.map(({ point, angle }, index) => {
    const blocks = [
      ...obstacles,
      ...taken,
      ...anchors
        .filter((_, other) => other !== index)
        .map(({ point }) => around(point, 2)),
    ];
    const centersBlocked = blocks.map(({ left, top, right, bottom }) => ({
      left: left - margin,
      top: top - margin,
      right: right + margin,
      bottom: bottom + margin,
    }));
    const clearBadge = (center: Point) =>
      contains(frame, center) &&
      !centersBlocked.some(
        (b) =>
          center.x > b.left &&
          center.x < b.right &&
          center.y > b.top &&
          center.y < b.bottom,
      );
    // If the pin covers the road itself, the line continues behind it to the true anchor.
    const clearLine = (center: Point) =>
      blocks.every(
        (box) => contains(box, point) || !crosses(point, center, box),
      );
    const take = (center: Point) => {
      taken.push(around(center, halfBadge));
      return { x: center.x - point.x, y: center.y - point.y };
    };
    let fallback: Point | null = null;
    for (const radius of radii) {
      for (const direction of directions) {
        const offset = atRadius(angle + (direction * Math.PI) / 4, radius);
        const center = { x: point.x + offset.x, y: point.y + offset.y };
        if (!clearBadge(center)) continue;
        if (clearLine(center)) return take(center);
        fallback ??= center;
      }
    }
    if (fallback) return take(fallback);

    const xs = [
      point.x,
      frame.left,
      frame.right,
      ...centersBlocked.flatMap(({ left, right }) => [left, right]),
    ];
    const ys = [
      point.y,
      frame.top,
      frame.bottom,
      ...centersBlocked.flatMap(({ top, bottom }) => [top, bottom]),
    ];
    let closest = Infinity;
    for (const x of xs) {
      for (const y of ys) {
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance < closest && clearBadge({ x, y })) {
          fallback = { x, y };
          closest = distance;
        }
      }
    }
    return fallback ? take(fallback) : null;
  });
}
