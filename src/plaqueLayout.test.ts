import { describe, expect, it } from "vitest";
import { lakeTitleBox, positionPlaques, type PlaqueBox } from "./plaqueLayout";

describe("linked brand plaques", () => {
  it("keeps all six names readable at desktop and portrait crossings, leaving T1A at the bottom", () => {
    for (const [width, height] of [
      [390, 787],
      [1200, 780],
    ]) {
      for (let t = 0; t < 300; t++) {
        const items: PlaqueBox[] = [
          "8FDE",
          "PondPilot",
          "SecondStack",
          "Alchemist",
          "Antares",
          "LakeSentry",
        ].map((key, i) => ({
          key,
          x: width / 2 + Math.sin(t / 20 + i) * 100,
          y: height / 2 + Math.cos(t / 24 + i) * 80,
          width: i === 2 ? 100 : 80,
          height: 36,
        }));
        items.push(lakeTitleBox(width, height));
        const positions = positionPlaques(items, width, height);
        expect(positionPlaques([...items].reverse(), width, height)).toEqual(
          positions,
        );
        expect(positions.get("T1A")).toEqual([width / 2, height - 104]);
        items.forEach((item, i) => {
          const [x, y] = positions.get(item.key)!;
          expect(x - item.width / 2).toBeGreaterThanOrEqual(8);
          expect(x + item.width / 2).toBeLessThanOrEqual(width - 8);
          expect(y - item.height / 2).toBeGreaterThanOrEqual(8);
          expect(y + item.height / 2).toBeLessThanOrEqual(height - 50);
          for (const other of items.slice(i + 1)) {
            const [ox, oy] = positions.get(other.key)!;
            expect(
              Math.abs(x - ox) >= (item.width + other.width) / 2 + 4 ||
                Math.abs(y - oy) >= (item.height + other.height) / 2 + 4,
            ).toBe(true);
          }
        });
      }
    }
  });
});

it("keeps a lone hover caption clear of the title at the bottom of the lake", () => {
  for (const [width, height] of [
    [1280, 725],
    [390, 690],
  ]) {
    const title = lakeTitleBox(width, height);
    const caption = {
      key: "Antares",
      x: title.x,
      y: height - 30,
      width: 110,
      height: 30,
    };
    const positions = positionPlaques([caption, title], width, height);
    const [x, y] = positions.get(caption.key)!;
    expect(
      Math.abs(x - title.x) >= (caption.width + title.width) / 2 + 5 ||
        Math.abs(y - title.y) >= (caption.height + title.height) / 2 + 5,
    ).toBe(true);
    expect(y + caption.height / 2).toBeLessThanOrEqual(height - 62);
    expect(positions.get("T1A")).toEqual([title.x, title.y]);
  }
});
