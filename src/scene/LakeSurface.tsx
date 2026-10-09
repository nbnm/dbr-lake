import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, Shape, ShaderMaterial } from "three";
import type { LakeLayout, Point } from "../layout";
import { Tree } from "./HarborModels";

function outline(width: number, depth: number) {
  const shape = new Shape();
  const r = 2.7;
  // Small, deterministic shoreline variations preserve the usable harbor area.
  shape.moveTo(-width + r, -depth);
  shape.bezierCurveTo(
    -width / 2,
    -depth - 0.22,
    width / 2,
    -depth + 0.18,
    width - r,
    -depth,
  );
  shape.quadraticCurveTo(width, -depth, width, -depth + r);
  shape.bezierCurveTo(
    width + 0.22,
    -depth / 2,
    width - 0.12,
    depth / 2,
    width,
    depth - r,
  );
  shape.quadraticCurveTo(width, depth, width - r, depth);
  shape.bezierCurveTo(
    width / 2,
    depth + 0.24,
    -width / 2,
    depth - 0.18,
    -width + r,
    depth,
  );
  shape.quadraticCurveTo(-width, depth, -width, depth - r);
  shape.bezierCurveTo(
    -width - 0.18,
    depth / 2,
    -width + 0.16,
    -depth / 2,
    -width,
    -depth + r,
  );
  shape.quadraticCurveTo(-width, -depth, -width + r, -depth);
  return shape;
}

const vertexShader = `varying vec2 vWater;
void main() { vWater = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = `uniform float uTime; varying vec2 vWater;
void main() {
  float drift = sin(vWater.x * .65 + vWater.y * .8 + uTime * .28);
  float wave = sin(vWater.x * 1.5 - vWater.y * 2.2 + drift * .55 + uTime * .42);
  float shimmer = smoothstep(.95, 1.0, wave) * .12;
  float broad = sin(vWater.x * .18 + vWater.y * .24 + uTime * .08) * .035;
  vec3 base = vec3(.47, .68, .60);
  gl_FragColor = vec4(base + broad + vec3(.18, .21, .17) * shimmer, 1.0);
}`;

function WaterRing({
  point,
  index,
  clock,
  reduced,
}: {
  point: Point;
  index: number;
  clock: RefObject<number>;
  reduced: boolean;
}) {
  const ring = useRef<Mesh>(null);
  useFrame(() => {
    if (!ring.current) return;
    const t = reduced ? index * 0.7 : clock.current / 6500 + index * 0.7;
    ring.current.scale.setScalar(0.7 + 0.13 * Math.sin(t));
    ring.current.position.x =
      point[0] + (reduced ? 0 : Math.sin(t * 0.3) * 0.1);
  });
  return (
    <mesh
      ref={ring}
      position={point}
      rotation={[-Math.PI / 2, 0, index * 1.7]}
      scale={[0.8, 0.8, 0.8]}
    >
      <ringGeometry args={[0.38, 0.398, 24, 1, 0, Math.PI * 0.83]} />
      <meshBasicMaterial
        color="#c3decb"
        transparent
        opacity={0.33}
        depthWrite={false}
      />
    </mesh>
  );
}

function Reeds({ point, seed }: { point: Point; seed: number }) {
  return (
    <group position={point}>
      <mesh position={[0, 0.015, 0]} scale={[1, 0.23, 0.7]}>
        <dodecahedronGeometry args={[0.48, 0]} />
        <meshStandardMaterial color="#b1bea0" />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => {
        const x = Math.sin(i * 2.4 + seed) * 0.26,
          z = Math.cos(i * 2.4 + seed) * 0.22,
          h = 0.3 + (i % 3) * 0.14;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0.12, i, -0.12]}>
            <mesh position={[0, h / 2, 0]}>
              <cylinderGeometry args={[0.013, 0.02, h, 4]} />
              <meshStandardMaterial color="#7c9267" />
            </mesh>
            <mesh position={[0, h, 0]}>
              <cylinderGeometry args={[0.034, 0.045, 0.12, 5]} />
              <meshStandardMaterial color="#987f58" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function LilyPads({
  point,
  index,
  clock,
  reduced,
}: {
  point: Point;
  index: number;
  clock: RefObject<number>;
  reduced: boolean;
}) {
  const group = useRef<Group>(null);
  useFrame(() => {
    if (group.current)
      group.current.rotation.y =
        index + (reduced ? 0 : Math.sin(clock.current / 13000 + index) * 0.1);
  });
  return (
    <group ref={group} position={point} rotation={[0, index, 0]}>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[i * 0.3 - 0.3, 0, Math.sin(i * 3) * 0.32]}>
          <mesh rotation={[-Math.PI / 2, 0, i * 2]}>
            <circleGeometry
              args={[0.19 + i * 0.025, 12, 0.2, Math.PI * 1.85]}
            />
            <meshStandardMaterial
              color={i === 1 ? "#5e8e70" : "#79a082"}
              side={2}
            />
          </mesh>
          {i === 1 && index % 2 === 0 && (
            <mesh position={[0, 0.06, 0]} scale={[1, 0.65, 1]}>
              <octahedronGeometry args={[0.1]} />
              <meshStandardMaterial color="#eee3cc" />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

export function LakeSurface({
  layout,
  clock,
  reduced,
}: {
  layout: LakeLayout;
  clock: RefObject<number>;
  reduced: boolean;
}) {
  const { halfWidth: w, halfDepth: d } = layout.water;
  const water = useMemo(() => outline(w, d), [w, d]);
  const shore = useMemo(() => {
    const ring = outline(w + 0.65, d + 0.65);
    ring.holes.push(water);
    return ring;
  }, [w, d, water]);
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame(() => {
    if (material.current)
      material.current.uniforms.uTime.value = reduced
        ? 0
        : (clock.current % 3_600_000) / 1000;
  });
  const rings = useMemo(
    () =>
      Array.from(
        { length: Math.min(50, Math.ceil((w * d) / 7)) },
        (_, i) =>
          [
            Math.sin(i * 2.399) * w * 0.88,
            0.085,
            Math.cos(i * 1.71) * d * 0.82,
          ] as Point,
      ).filter(
        (p) =>
          !layout.docks.some(
            (dock) =>
              Math.abs(p[0] - dock.center[0]) < dock.width / 2 + 0.4 &&
              Math.abs(p[2] - dock.center[2]) < 2.5,
          ),
      ),
    [layout, w, d],
  );
  const patches = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        return [
          side * w * 0.91,
          0.085,
          -d * 0.72 + Math.floor(i / 2) * d * 0.47,
        ] as Point;
      }),
    [w, d],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
        <extrudeGeometry
          args={[
            water,
            { depth: 0.58, bevelEnabled: false, curveSegments: 12 },
          ]}
        />
        <meshStandardMaterial color="#b8c5ab" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.56, 0]}>
        <extrudeGeometry
          args={[
            shore,
            {
              depth: 0.63,
              bevelEnabled: true,
              bevelSize: 0.12,
              bevelThickness: 0.08,
              bevelSegments: 1,
              curveSegments: 12,
            },
          ]}
        />
        <meshStandardMaterial color="#ced7bb" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.075, 0]}>
        <shapeGeometry args={[water, 24]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
        />
      </mesh>
      {rings.map((p, i) => (
        <WaterRing
          key={i}
          point={p}
          index={i}
          clock={clock}
          reduced={reduced}
        />
      ))}
      {patches.map((p, i) => (
        <group key={i}>
          <Reeds
            point={[p[0] + (p[0] < 0 ? -0.45 : 0.45), 0.075, p[2]]}
            seed={i}
          />
          <LilyPads
            point={[p[0] + (p[0] < 0 ? 0.6 : -0.6), 0.086, p[2] + 0.7]}
            index={i}
            clock={clock}
            reduced={reduced}
          />
          <mesh
            position={[p[0] + (p[0] < 0 ? -0.65 : 0.65), 0.12, p[2] - 0.6]}
            rotation={[0.2, i * 2, 0.2]}
            scale={[0.5, 0.23, 0.34]}
          >
            <dodecahedronGeometry args={[0.65, 0]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#9bafa0" : "#b9c4a9"} />
          </mesh>
        </group>
      ))}
      {[-1, 1].flatMap((side) =>
        [-0.65, -0.3, 0.25, 0.64].map((x, i) => (
          <Tree
            key={`${side}:${i}`}
            position={[w * x, 0.1, side * (d + 0.18)]}
            scale={0.55 + (i % 3) * 0.14}
          />
        )),
      )}
    </group>
  );
}
