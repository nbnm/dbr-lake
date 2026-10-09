import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { Line } from "@react-three/drei";
import type { Point } from "../layout";
import { PAPER_SHIP_SCALE, PAPER_PLANE_SCALE } from "../vesselSize";

function paperGeometry(faces: Point[][], shades: string[]) {
  const geometry = new BufferGeometry();
  const vertices = faces.flat(2);
  const colors = faces.flatMap((_, i) => {
    const color = new Color(shades[i % shades.length]);
    return [...color.toArray(), ...color.toArray(), ...color.toArray()];
  });
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
const rim: Point[] = [
  [0, 0.22, 0.9],
  [0.44, 0.18, 0.34],
  [0.44, 0.18, -0.34],
  [0, 0.22, -0.9],
  [-0.44, 0.18, -0.34],
  [-0.44, 0.18, 0.34],
];
const keel: Point[] = [
  [0, -0.13, 0.52],
  [0.23, -0.13, 0.18],
  [0.23, -0.13, -0.18],
  [0, -0.13, -0.52],
  [-0.23, -0.13, -0.18],
  [-0.23, -0.13, 0.18],
];
const hull = paperGeometry(
  rim.flatMap((v, i) => {
    const next = (i + 1) % rim.length;
    return [
      [v, rim[next], keel[i]],
      [rim[next], keel[next], keel[i]],
      [v, [0.0, 0.03, 0] as Point, rim[next]],
    ];
  }),
  ["#faf7e9", "#deded4", "#f4f0df", "#eee9d7", "#fdfbf2", "#e2e3d7"],
);
const fold = paperGeometry(
  [
    [
      [0, 0.23, -0.57],
      [0, 0.76, -0.04],
      [0.19, 0.07, 0.18],
    ],
    [
      [0, 0.76, -0.04],
      [0, 0.23, 0.57],
      [0.19, 0.07, 0.18],
    ],
    [
      [0, 0.23, 0.57],
      [0, 0.76, -0.04],
      [-0.19, 0.07, 0.18],
    ],
    [
      [0, 0.76, -0.04],
      [0, 0.23, -0.57],
      [-0.19, 0.07, 0.18],
    ],
  ],
  ["#fffdf4", "#efecdf", "#e1e0d5", "#fbf9ee"],
);
const nose: Point = [0, 0.04, 1.1];
const ridge: Point = [0, 0.23, -0.58];
const left: Point = [-0.94, 0.02, -0.64];
const right: Point = [0.94, 0.02, -0.64];
const plane = paperGeometry(
  [
    [nose, left, [-0.3, 0.09, -0.5]],
    [nose, [-0.3, 0.09, -0.5], ridge],
    [nose, ridge, [0.3, 0.09, -0.5]],
    [nose, [0.3, 0.09, -0.5], right],
    [left, [-0.87, 0.16, -0.61], [-0.3, 0.09, -0.5]],
    [right, [0.3, 0.09, -0.5], [0.87, 0.16, -0.61]],
    [nose, [0, -0.17, -0.52], [-0.13, -0.06, -0.59]],
    [nose, [0.13, -0.06, -0.59], [0, -0.17, -0.52]],
    [ridge, [-0.3, 0.09, -0.5], [-0.13, -0.06, -0.59]],
    [ridge, [0.13, -0.06, -0.59], [0.3, 0.09, -0.5]],
  ],
  [
    "#eeeede",
    "#fffdf3",
    "#e6e7db",
    "#f9f7e8",
    "#fdfbf0",
    "#dcdfd3",
    "#d4dbd3",
    "#e9eade",
  ],
);

function selectionBox(geometries: BufferGeometry[]) {
  const bounds = new Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
  }
  const size = bounds.getSize(new Vector3()).multiplyScalar(2);
  const center = bounds.getCenter(new Vector3());
  return new BoxGeometry(size.x, size.y, size.z).translate(
    center.x,
    center.y,
    center.z,
  );
}
const shipSelectionBox = selectionBox([hull, fold]);
const planeSelectionBox = selectionBox([plane]);
// Hidden materials skip rendering while their meshes remain raycast targets.
const selectionMaterial = new MeshBasicMaterial({ visible: false });

export function PaperShip({ tint }: { tint: string }) {
  return (
    <group scale={PAPER_SHIP_SCALE}>
      <mesh
        name="ship-hitbox"
        geometry={shipSelectionBox}
        material={selectionMaterial}
      />
      <mesh geometry={hull}>
        <meshStandardMaterial
          color={tint}
          vertexColors
          side={2}
          roughness={0.92}
        />
      </mesh>
      <mesh geometry={fold}>
        <meshStandardMaterial
          color={tint}
          vertexColors
          side={2}
          roughness={0.92}
        />
      </mesh>
      <Line
        points={[rim[0], rim[1], rim[2], rim[3], rim[4], rim[5], rim[0]]}
        color="#929f92"
        lineWidth={0.55}
        transparent
        opacity={0.55}
      />
      <Line
        points={[
          [0, 0.23, -0.57],
          [0, 0.76, -0.04],
          [0, 0.23, 0.57],
        ]}
        color="#a7ad9f"
        lineWidth={0.5}
        transparent
        opacity={0.55}
      />
    </group>
  );
}
export function PaperPlane({ tint }: { tint: string }) {
  return (
    <group scale={PAPER_PLANE_SCALE}>
      <mesh
        name="plane-hitbox"
        geometry={planeSelectionBox}
        material={selectionMaterial}
      />
      <mesh geometry={plane}>
        <meshStandardMaterial
          color={tint}
          vertexColors
          side={2}
          roughness={0.9}
        />
      </mesh>
      <Line
        points={[left, nose, right]}
        color="#8b9b90"
        lineWidth={0.6}
        transparent
        opacity={0.65}
      />
      <Line
        points={[nose, ridge]}
        color="#a0a798"
        lineWidth={0.7}
        transparent
        opacity={0.6}
      />
    </group>
  );
}
