import { describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import {
  buildLakeLayout,
  cameraFit,
  CAMERA_OFFSET,
  PORTRAIT_CAMERA_OFFSET,
} from "./layout";
import { AIR_LEVELS, cruiseHeight } from "./navigation";
import { buildSurroundings } from "./environment";
import {
  t1aBackdrop,
  t1aBackdropBounds,
  zeppelinBounds,
  zeppelinDimensions,
  zeppelinPose,
  ZEPPELIN_LOOP_MS,
} from "./landmarks";
import type { LakeObject } from "./types";

function inventory(count: number): LakeObject[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m:c${i}.s.t`,
    metastore_id: "m",
    catalog: `c${i}`,
    schema_name: "s",
    name: "t",
    type: "table",
    workspace_ids: ["w"],
    position: [0, 0, 0],
  }));
}

describe("Alchemist's ambient sky lane", () => {
  it("loops continuously above aircraft and the Antares tower for every lake size", () => {
    for (const count of [0, 1, 8, 80]) {
      const { water } = buildLakeLayout(inventory(count));
      const { radius, gondolaDrop } = zeppelinDimensions(water);
      const bounds = zeppelinBounds(water);
      const xs: number[] = [];
      for (let at = 0; at < ZEPPELIN_LOOP_MS * 2; at += 500) {
        const { point, heading, roll } = zeppelinPose(water, at);
        expect([...point, heading, roll].every(Number.isFinite)).toBe(true);
        expect(point[1] - radius - gondolaDrop - 0.2).toBeGreaterThan(
          cruiseHeight(AIR_LEVELS - 1) + 1,
        );
        expect(point[1] - radius - gondolaDrop - 0.2).toBeGreaterThan(8.2);
        point.forEach((value, axis) => {
          expect(value).toBeGreaterThan(bounds.min[axis]);
          expect(value).toBeLessThan(bounds.max[axis]);
        });
        xs.push(point[0]);
      }
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(
        water.halfWidth * 0.9,
      );
      const start = zeppelinPose(water, 0),
        end = zeppelinPose(water, ZEPPELIN_LOOP_MS);
      start.point.forEach((v, axis) =>
        expect(end.point[axis]).toBeCloseTo(v, 8),
      );
      expect(end.heading).toBeCloseTo(start.heading, 8);
      expect(end.roll).toBeCloseTo(start.roll, 8);
      expect(
        new Vector3(
          ...zeppelinPose(water, ZEPPELIN_LOOP_MS - 1).point,
        ).distanceTo(
          new Vector3(...zeppelinPose(water, ZEPPELIN_LOOP_MS + 1).point),
        ),
      ).toBeLessThan(0.02);
    }
  });

  it("holds a visible pose for reduced motion while ordinary flight continues through multiple replay lengths", () => {
    const { water } = buildLakeLayout(inventory(6));
    expect(zeppelinPose(water, 86_400_000, true)).toEqual(
      zeppelinPose(water, 0, true),
    );
    expect(zeppelinPose(water, 24_000).point).not.toEqual(
      zeppelinPose(water, 28_000).point,
    );
    expect(zeppelinPose(water, 86_400_000).point.every(Number.isFinite)).toBe(
      true,
    );
  });
});

describe("visible brand landmarks", () => {
  it("raises T1A behind the far shore, above the trees, with a clear foundation", () => {
    for (const count of [0, 4, 80]) {
      const lake = buildLakeLayout(inventory(count));
      const sign = t1aBackdrop(lake.water);
      expect(sign.point[2]).toBeLessThan(-lake.water.halfDepth - 3);
      expect(Math.abs(sign.point[2])).toBeLessThan(lake.ground.halfDepth - 0.8);
      expect(sign.point[1] + sign.centerY - sign.height / 2).toBeGreaterThan(3);
      for (const tree of buildSurroundings(lake).trees)
        expect(
          Math.hypot(
            tree.point[0] - sign.point[0],
            tree.point[2] - sign.point[2],
          ),
        ).toBeGreaterThan(2.2);
    }
  });

  it("frames the complete flight loop and the T1A sign in desktop and portrait overviews", () => {
    for (const count of [0, 4, 80]) {
      const lake = buildLakeLayout(inventory(count));
      for (const [width, height] of [
        [1200, 725],
        [390, 690],
        [800, 450],
      ]) {
        const offset = width < 600 ? PORTRAIT_CAMERA_OFFSET : CAMERA_OFFSET;
        const camera = new OrthographicCamera(
          -width / 2,
          width / 2,
          height / 2,
          -height / 2,
          0.1,
          5000,
        );
        const target = new Vector3(
          (lake.bounds.min[0] + lake.bounds.max[0]) / 2,
          2,
          (lake.bounds.min[2] + lake.bounds.max[2]) / 2,
        );
        camera.position
          .copy(target)
          .add(new Vector3(...offset).multiplyScalar(10));
        camera.lookAt(target);
        camera.zoom = cameraFit(lake, width, height, offset);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        for (const bounds of [
          zeppelinBounds(lake.water),
          t1aBackdropBounds(lake.water),
        ])
          for (const x of [bounds.min[0], bounds.max[0]])
            for (const y of [bounds.min[1], bounds.max[1]])
              for (const z of [bounds.min[2], bounds.max[2]]) {
                const p = new Vector3(x, y, z).project(camera);
                expect(Math.abs(p.x)).toBeLessThan(0.99);
                expect(Math.abs(p.y)).toBeLessThan(0.99);
              }
      }
    }
  });
});
