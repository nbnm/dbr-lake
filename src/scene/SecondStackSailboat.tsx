import { useContext, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from "three";
import type { LakeLayout } from "../layout";
import { sailboatPose } from "../landmarks";
import { SAILBOAT_SIZE_MULTIPLIER } from "../landmarkSize";
import { LandmarkLink, LandmarkModel } from "./LandmarkLink";
import { SceneTraffic } from "./SceneTraffic";

const URL = "https://secondstack.ai/";

function triangle(vertices: number[]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function hullGeometry() {
  const geometry = new BufferGeometry();
  const rim = [
    [0, 0.24, 1.65],
    [-0.6, 0.24, 0.65],
    [-0.55, 0.24, -1.3],
    [0.55, 0.24, -1.3],
    [0.6, 0.24, 0.65],
  ];
  const keel = [
    [0, -0.04, 1.3],
    [-0.36, -0.04, 0.6],
    [-0.31, -0.04, -1.15],
    [0.31, -0.04, -1.15],
    [0.36, -0.04, 0.6],
  ];
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([...rim, ...keel].flat(), 3),
  );
  const indices = [0, 2, 1, 0, 3, 2, 0, 4, 3, 5, 6, 7, 5, 7, 8, 5, 8, 9];
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5;
    indices.push(i, next, i + 5, next, next + 5, i + 5);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function SailPrint({
  texture,
  point,
  width,
  height,
}: {
  texture: Texture;
  point: [number, number];
  width: number;
  height: number;
}) {
  // Separate outward-facing prints keep the wordmark readable from either bank.
  return [-1, 1].map((side) => (
    <mesh
      key={side}
      position={[side * 0.012, point[0], point[1]]}
      rotation={[0, (side * Math.PI) / 2, 0]}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.05}
        toneMapped={false}
      />
    </mesh>
  ));
}

export function SecondStackSailboat({
  water,
  reduced,
}: {
  water: LakeLayout["water"];
  reduced: boolean;
}) {
  const boat = useRef<Group>(null);
  const traffic = useContext(SceneTraffic);
  const sourceTextures = useLoader(TextureLoader, [
    "/brands/secondstack-mark.svg",
    "/brands/secondstack.svg",
  ]);
  const [mark, logo] = useMemo(
    () =>
      sourceTextures.map((source) => {
        const texture = source.clone();
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      }),
    [sourceTextures],
  );
  useEffect(
    () => () => {
      mark.dispose();
      logo.dispose();
    },
    [mark, logo],
  );
  const hull = useMemo(hullGeometry, []);
  const main = useMemo(
    () => triangle([0, 0.63, -0.04, 0, 3.85, -0.04, 0, 0.63, -1.62]),
    [],
  );
  const jib = useMemo(
    () => triangle([0, 0.63, 0.08, 0, 3.22, 0.08, 0, 0.63, 1.4]),
    [],
  );
  const initial = sailboatPose(water, 0, reduced);
  useFrame(({ clock }) => {
    if (!boat.current) return;
    const pose = sailboatPose(water, clock.elapsedTime * 1000, reduced);
    const position = traffic?.current.get("ambient:sailboat");
    if (position) boat.current.position.copy(position);
    else boat.current.position.set(...pose.point);
    boat.current.rotation.set(0, pose.heading, pose.roll);
  });
  return (
    <LandmarkModel
      name="secondstack-sailboat"
      ref={boat}
      scale={SAILBOAT_SIZE_MULTIPLIER}
      position={initial.point}
      rotation={[0, initial.heading, initial.roll]}
      onClick={(event) => {
        event.stopPropagation();
        window.open(URL, "_blank", "noopener,noreferrer");
      }}
    >
      <mesh geometry={hull}>
        <meshStandardMaterial color="#e6e1ce" flatShading />
      </mesh>
      <mesh position={[0, 0.33, -0.57]}>
        <boxGeometry args={[0.68, 0.16, 0.8]} />
        <meshStandardMaterial color="#8caaa5" />
      </mesh>
      <mesh position={[0, 2.08, 0]}>
        <cylinderGeometry args={[0.035, 0.045, 3.65, 8]} />
        <meshStandardMaterial color="#a08b68" />
      </mesh>
      <mesh geometry={main}>
        <meshStandardMaterial
          color="#fffdf2"
          side={DoubleSide}
          roughness={0.9}
        />
      </mesh>
      <mesh geometry={jib}>
        <meshStandardMaterial
          color="#f7f5e7"
          side={DoubleSide}
          roughness={0.9}
        />
      </mesh>
      <SailPrint
        texture={mark}
        point={[1.45, -0.67]}
        width={0.76}
        height={0.76}
      />
      <SailPrint
        texture={logo}
        point={[0.88, -0.73]}
        width={1.22}
        height={(1.22 * 130) / 600}
      />
      <SailPrint
        texture={mark}
        point={[1.24, 0.44]}
        width={0.45}
        height={0.45}
      />
      <Line
        points={[
          [0, 3.91, 0],
          [0, 0.28, 1.65],
        ]}
        color="#b5baa6"
        lineWidth={0.75}
      />
      <Line
        points={[
          [0, 0.63, -0.03],
          [0, 0.63, -1.67],
        ]}
        color="#aa9671"
        lineWidth={2}
      />
      <mesh
        position={[0, -0.08, 0.05]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.9, 1.65, 1]}
      >
        <ringGeometry args={[0.7, 0.72, 40]} />
        <meshBasicMaterial
          color="#d3e5d6"
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>
      <LandmarkLink name="SecondStack" href={URL} point={[0, 4.45, 0]} />
    </LandmarkModel>
  );
}
