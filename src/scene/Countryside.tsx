import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { LakeLayout } from "../layout";
import {
  buildSurroundings,
  type FieldPatch,
  type ForestTree,
  type CountryRoad,
} from "../environment";

function Grove({ trees }: { trees: ForestTree[] }) {
  const trunks = useRef<InstancedMesh>(null!);
  const lower = useRef<InstancedMesh>(null!);
  const upper = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    if (!trees.length) return;
    const matrix = new Matrix4(),
      rotation = new Quaternion();
    const color = new Color();
    trees.forEach(({ point: [x, y, z], scale, shade }, i) => {
      const put = (mesh: InstancedMesh, offset: number) => {
        matrix.compose(
          new Vector3(x, y + offset * scale, z),
          rotation,
          new Vector3(scale, scale, scale),
        );
        mesh.setMatrixAt(i, matrix);
      };
      put(trunks.current, 0.32);
      put(lower.current, 0.9);
      put(upper.current, 1.32);
      lower.current.setColorAt(
        i,
        color.set(["#6e896b", "#779475", "#829774"][shade]),
      );
      upper.current.setColorAt(
        i,
        color.set(["#8caa80", "#9cad83", "#8f9d72"][shade]),
      );
    });
    for (const mesh of [trunks.current, lower.current, upper.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [trees]);
  if (!trees.length) return null;
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]}>
        <cylinderGeometry args={[0.07, 0.1, 0.64, 5]} />
        <meshStandardMaterial color="#927e61" />
      </instancedMesh>
      <instancedMesh ref={lower} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[0.45, 1.1, 6]} />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh ref={upper} args={[undefined, undefined, trees.length]}>
        <coneGeometry args={[0.31, 0.8, 6]} />
        <meshStandardMaterial />
      </instancedMesh>
    </group>
  );
}

function Field({ field }: { field: FieldPatch }) {
  const colors = {
    wheat: ["#c3bb83", "#d2c796"],
    meadow: ["#a4b783", "#92a775"],
    tilled: ["#ae9e7b", "#c0ad86"],
  };
  const [soil, crop] = colors[field.crop];
  return (
    <group position={field.center}>
      <mesh>
        <boxGeometry args={[field.width, 0.045, field.depth]} />
        <meshStandardMaterial color={soil} roughness={1} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[((i - 4) * field.width) / 10, 0.031, 0]}>
          <boxGeometry
            args={[
              field.width / 26,
              field.crop === "wheat" ? 0.08 : 0.018,
              field.depth - 0.18,
            ]}
          />
          <meshStandardMaterial color={crop} roughness={1} />
        </mesh>
      ))}
      {field.crop === "wheat" &&
        [0, 1].map((i) => (
          <mesh
            key={i}
            position={[
              field.width / 2 - 0.55 - i * 0.75,
              0.19,
              field.depth / 2 - 0.4,
            ]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.22, 0.22, 0.4, 8]} />
            <meshStandardMaterial color="#d2c194" />
          </mesh>
        ))}
    </group>
  );
}

export function Countryside({ layout }: { layout: LakeLayout }) {
  const { fields, trees, roads } = useMemo(
    () => buildSurroundings(layout),
    [layout],
  );
  return (
    <group>
      <Grove trees={trees} />
      {fields.map((field, i) => (
        <Field key={i} field={field} />
      ))}
      <Paths roads={roads} />
    </group>
  );
}

function Paths({ roads }: { roads: CountryRoad[] }) {
  const mesh = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    const matrix = new Matrix4(),
      rotation = new Quaternion();
    const up = new Vector3(0, 1, 0);
    roads.forEach(({ from, to }, i) => {
      const dx = to[0] - from[0],
        dz = to[2] - from[2];
      rotation.setFromAxisAngle(up, -Math.atan2(dz, dx));
      matrix.compose(
        new Vector3((from[0] + to[0]) / 2, from[1], (from[2] + to[2]) / 2),
        rotation,
        new Vector3(Math.hypot(dx, dz), 1, 1),
      );
      mesh.current.setMatrixAt(i, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [roads]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, roads.length]}>
      <boxGeometry args={[1, 0.018, 0.48]} />
      <meshStandardMaterial color="#cec4a4" roughness={1} />
    </instancedMesh>
  );
}
