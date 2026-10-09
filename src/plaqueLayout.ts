export interface PlaqueBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned?: boolean;
}

// Keep linked plaques readable when separate world objects project to the
// same place. Only labels move; the models retain their lake/sky positions.
export function positionPlaques(
  items: PlaqueBox[],
  width: number,
  height: number,
) {
  const placed: PlaqueBox[] = [];
  for (const item of [...items].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) || a.key.localeCompare(b.key),
  )) {
    const clamp = (x: number, y: number) => ({
      ...item,
      x: Math.max(item.width / 2 + 8, Math.min(width - item.width / 2 - 8, x)),
      y: Math.max(
        item.height / 2 + 8,
        Math.min(height - item.height / 2 - 62, y),
      ),
    });
    let box = item.pinned ? item : clamp(item.x, item.y);
    const overlaps = (p: PlaqueBox) =>
      placed.some(
        (q) =>
          Math.abs(p.x - q.x) < (p.width + q.width) / 2 + 5 &&
          Math.abs(p.y - q.y) < (p.height + q.height) / 2 + 5,
      );
    if (!item.pinned && overlaps(box)) {
      const candidates: PlaqueBox[] = [];
      for (let step = 1; step <= items.length; step++) {
        candidates.push(
          clamp(item.x, item.y - step * (item.height + 6)),
          clamp(item.x, item.y + step * (item.height + 6)),
          clamp(item.x - step * (item.width + 6), item.y),
          clamp(item.x + step * (item.width + 6), item.y),
        );
      }
      const available = candidates
        .filter((p) => !overlaps(p))
        .sort(
          (a, b) =>
            Math.hypot(a.x - item.x, a.y - item.y) -
            Math.hypot(b.x - item.x, b.y - item.y),
        );
      box = available[0] ?? box;
    }
    placed.push(box);
  }
  return new Map(
    placed.map((box) => [box.key, [box.x, box.y] as [number, number]]),
  );
}
