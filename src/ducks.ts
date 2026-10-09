/** Seeded quiet intervals keep captured demo playback repeatable. */
export function duckVisible(elapsedMs: number): boolean {
  let seed = 17;
  let next = 0;
  // 400 cycles cover the complete 24-hour capture, even at the shortest interval.
  for (let cycle = 0; next <= elapsedMs && cycle < 400; cycle++) {
    seed = (seed * 16807) % 2147483647;
    next += 180_000 + (seed % 300_001);
    if (elapsedMs >= next && elapsedMs < next + 40_000) return true;
    next += 40_000;
  }
  return false;
}
