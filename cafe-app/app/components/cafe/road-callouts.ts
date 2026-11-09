type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };
export type RoadSource = { osmId: number; point: Point };
type RoadReference = { sources: RoadSource[]; offsets: Point[] };
export type RoadPlacement = { source: RoadSource; offset: Point };

export const roadBadgeSize = 17;
const halfBadge = roadBadgeSize / 2;
const anchorClearance = 3;
const badgeClearance = 3;
const directions = [0, 1, -1, 2, -2, 3, -3, 4];
const radii = [halfBadge + 9, 25, 35];

export function roadCalloutOffsets(angle: number): Point[] {
  return radii.flatMap((radius) =>
    directions.map((direction) => {
      const turn = angle + (direction * Math.PI) / 4;
      return { x: Math.cos(turn) * radius, y: Math.sin(turn) * radius };
    }),
  );
}

function around({ x, y }: Point, radius: number): Box {
  return {
    left: x - radius,
    right: x + radius,
    top: y - radius,
    bottom: y + radius,
  };
}

function pad(box: Box, amount: number): Box {
  return {
    left: box.left - amount,
    top: box.top - amount,
    right: box.right + amount,
    bottom: box.bottom + amount,
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
  references: RoadReference[],
  bounds: { width: number; height: number },
  obstacles: Box[],
): (RoadPlacement | null)[] {
  const frame = { left: 0, top: 0, right: bounds.width, bottom: bounds.height };
  const anchorFrame = pad(frame, -anchorClearance);
  const badgeFrame = pad(frame, -(halfBadge + badgeClearance));
  const taken = obstacles.map((box) => pad(box, 1));
  return references.map(({ sources, offsets }) => {
    const dotBlocks = taken.map((box) => pad(box, anchorClearance));
    const badgeBlocks = taken.map((box) =>
      pad(box, halfBadge + badgeClearance),
    );
    for (const source of sources) {
      const anchor = {
        x: source.point.x * bounds.width,
        y: source.point.y * bounds.height,
      };
      if (
        !contains(anchorFrame, anchor) ||
        dotBlocks.some((box) => contains(box, anchor))
      )
        continue;
      for (const offset of offsets) {
        const center = { x: anchor.x + offset.x, y: anchor.y + offset.y };
        if (
          !contains(badgeFrame, center) ||
          badgeBlocks.some((box) => contains(box, center)) ||
          taken.some((box) => crosses(anchor, center, box))
        )
          continue;
        taken.push(
          around(anchor, anchorClearance),
          around(center, halfBadge),
          pad(
            {
              left: Math.min(anchor.x, center.x),
              top: Math.min(anchor.y, center.y),
              right: Math.max(anchor.x, center.x),
              bottom: Math.max(anchor.y, center.y),
            },
            1,
          ),
        );
        return { source, offset };
      }
    }
    return null;
  });
}
