import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { ArrowUpRight } from "lucide-react";
import { BufferGeometry, Float32BufferAttribute, Group } from "three";
import type { Point } from "../layout";
import { Label } from "./SceneLabel";

const LAKESENTRY_URL = "https://lakesentry.io/";
const PONDPILOT_URL = "https://pondpilot.io/";
const hover = () => {
  document.body.style.cursor = "pointer";
};
const unhover = () => {
  document.body.style.cursor = "";
};
const visit = (url: string) =>
  window.open(url, "_blank", "noopener,noreferrer");

function LandmarkLink({
  name,
  href,
  point,
  theme,
}: {
  name: string;
  href: string;
  point: Point;
  theme: "lighthouse" | "ducks";
}) {
  return (
    <Label center position={point} zIndexRange={[18, 0]}>
      <a
        className={`landmark-link ${theme}-link`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visit ${name} (opens in a new tab)`}
        onClick={(event) => event.stopPropagation()}
      >
        <strong>{name}</strong>
        <ArrowUpRight size={12} aria-hidden="true" />
      </a>
    </Label>
  );
}

// The logo's diagonal stripes become a continuous band around the tapered tower.
function spiralStripe() {
  const positions: number[] = [],
    indices: number[] = [];
  const segments = 144,
    height = 2.4,
    width = 0.33;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      angle = t * Math.PI * 4.7;
    for (const edge of [-1, 1]) {
      const y = Math.max(
        0,
        Math.min(height, t * (height + width) - width / 2 + (edge * width) / 2),
      );
      const radius = 0.76 - (y / height) * 0.25 + 0.012;
      positions.push(
        Math.sin(angle) * radius,
        y + 0.53,
        Math.cos(angle) * radius,
      );
    }
    if (i < segments) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function LakeSentryLighthouse({
  point,
  clock,
  reduced,
}: {
  point: Point;
  clock: RefObject<number>;
  reduced: boolean;
}) {
  const lantern = useRef<Group>(null);
  const stripe = useMemo(spiralStripe, []);
  useFrame(() => {
    if (lantern.current)
      lantern.current.rotation.y = reduced
        ? Math.PI / 4
        : ((clock.current % 24_000) / 24_000) * Math.PI * 2;
  });
  return (
    <group
      position={point}
      onClick={(event) => {
        event.stopPropagation();
        visit(LAKESENTRY_URL);
      }}
      onPointerOver={hover}
      onPointerOut={unhover}
    >
      <mesh
        position={[0, -0.06, 0]}
        scale={[1, 0.23, 0.9]}
        rotation={[0, 0.3, 0]}
      >
        <dodecahedronGeometry args={[1.5, 0]} />
        <meshStandardMaterial color="#b9c4af" flatShading />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[1.1, 1.2, 0.27, 12]} />
        <meshStandardMaterial color="#d9d6c3" />
      </mesh>
      <mesh position={[0, 0.43, 0]}>
        <cylinderGeometry args={[0.82, 0.94, 0.17, 12]} />
        <meshStandardMaterial color="#002460" />
      </mesh>
      <mesh position={[0, 1.73, 0]}>
        <cylinderGeometry args={[0.51, 0.76, 2.4, 48]} />
        <meshStandardMaterial color="#f80000" roughness={0.82} />
      </mesh>
      <mesh geometry={stripe}>
        <meshStandardMaterial color="#fff9ee" side={2} roughness={0.9} />
      </mesh>
      <RoundedBox
        args={[0.32, 0.55, 0.08]}
        radius={0.06}
        smoothness={2}
        position={[0, 0.82, 0.73]}
      >
        <meshStandardMaterial color="#002460" />
      </RoundedBox>
      <mesh position={[0, 2.34, 0.57]}>
        <boxGeometry args={[0.16, 0.28, 0.055]} />
        <meshStandardMaterial color="#002460" />
      </mesh>
      <mesh position={[0, 3.02, 0]}>
        <cylinderGeometry args={[0.83, 0.83, 0.18, 12]} />
        <meshStandardMaterial color="#002460" />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        return (
          <mesh
            key={i}
            position={[Math.sin(angle) * 0.69, 3.28, Math.cos(angle) * 0.69]}
          >
            <cylinderGeometry args={[0.025, 0.025, 0.45, 5]} />
            <meshStandardMaterial color="#002460" />
          </mesh>
        );
      })}
      <mesh position={[0, 3.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.69, 0.028, 5, 24]} />
        <meshStandardMaterial color="#002460" />
      </mesh>
      <mesh position={[0, 3.47, 0]}>
        <cylinderGeometry args={[0.46, 0.46, 0.72, 8]} />
        <meshStandardMaterial
          color="#7db4f7"
          transparent
          opacity={0.58}
          roughness={0.15}
        />
      </mesh>
      <group ref={lantern} position={[0, 3.45, 0]}>
        <mesh>
          <sphereGeometry args={[0.18, 12, 8]} />
          <meshStandardMaterial
            color="#fff2b9"
            emissive="#fbe2a2"
            emissiveIntensity={1.2}
          />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 1.16, 0, 0]}
            rotation={[0, 0, (side * Math.PI) / 2]}
          >
            <coneGeometry args={[0.34, 2.05, 12, 1, true]} />
            <meshBasicMaterial
              color="#fbe6b0"
              transparent
              opacity={0.12}
              depthWrite={false}
              side={2}
            />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 3.91, 0]}>
        <cylinderGeometry args={[0.67, 0.67, 0.12, 8]} />
        <meshStandardMaterial color="#002460" />
      </mesh>
      <mesh position={[0, 4.2, 0]} rotation={[0, Math.PI / 8, 0]}>
        <coneGeometry args={[0.82, 0.54, 8]} />
        <meshStandardMaterial color="#f80000" />
      </mesh>
      <mesh position={[0, 4.55, 0]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color="#002460" />
      </mesh>
      <LandmarkLink
        name="LakeSentry"
        href={LAKESENTRY_URL}
        point={[0, 4.95, 0]}
        theme="lighthouse"
      />
    </group>
  );
}

function PondPilotDuck({ point, scale = 1 }: { point: Point; scale?: number }) {
  return (
    <group position={point} scale={scale}>
      <mesh position={[0, 0.2, -0.08]} scale={[0.37, 0.27, 0.59]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#a5a8aa" roughness={0.9} />
      </mesh>
      <mesh
        position={[0, 0.28, -0.57]}
        rotation={[-0.5, 0, 0]}
        scale={[1, 1, 0.65]}
      >
        <coneGeometry args={[0.18, 0.35, 8]} />
        <meshStandardMaterial color="#8e9395" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * 0.32, 0.25, -0.14]}
          scale={[0.065, 0.15, 0.32]}
          rotation={[0.12, 0, side * -0.12]}
        >
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#737b7d" />
        </mesh>
      ))}
      <mesh position={[0, 0.47, 0.32]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshStandardMaterial color="#4cae4f" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.29, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.18, 0.022, 6, 20]} />
        <meshStandardMaterial color="#f5f1d8" />
      </mesh>
      <RoundedBox
        args={[0.31, 0.115, 0.34]}
        radius={0.055}
        smoothness={2}
        position={[0, 0.44, 0.64]}
      >
        <meshStandardMaterial color="#f4a462" roughness={0.8} />
      </RoundedBox>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.202, 0.55, 0.49]}>
          <mesh>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color="#1b255a" />
          </mesh>
          <mesh position={[side * 0.005, 0.009, 0.029]}>
            <sphereGeometry args={[0.009, 6, 4]} />
            <meshBasicMaterial color="#fffdf2" />
          </mesh>
        </group>
      ))}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.13, -0.12]}
        scale={[0.8, 1.3, 1]}
      >
        <ringGeometry args={[0.62, 0.642, 32, 1, 0.5, Math.PI * 1.4]} />
        <meshBasicMaterial
          color="#d1e2cd"
          transparent
          opacity={0.42}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function PondPilotDucks({
  point,
  clock,
  reduced,
}: {
  point: Point;
  clock: RefObject<number>;
  reduced: boolean;
}) {
  const flock = useRef<Group>(null);
  useFrame(() => {
    if (!flock.current) return;
    const drift = reduced ? 0 : Math.sin(clock.current / 90_000);
    flock.current.position.z = point[2] + drift * 0.35;
    flock.current.position.y =
      point[1] + (reduced ? 0 : Math.sin(clock.current / 1800) * 0.018);
    flock.current.rotation.y = -Math.PI / 5 + drift * 0.3;
  });
  return (
    <group
      ref={flock}
      position={point}
      onClick={(event) => {
        event.stopPropagation();
        visit(PONDPILOT_URL);
      }}
      onPointerOver={hover}
      onPointerOut={unhover}
    >
      <PondPilotDuck point={[0, 0, 0]} />
      <PondPilotDuck point={[-0.8, 0, -0.85]} scale={0.74} />
      <PondPilotDuck point={[0.54, 0, -1.3]} scale={0.62} />
      <LandmarkLink
        name="PondPilot"
        href={PONDPILOT_URL}
        point={[-0.2, 1.3, -0.2]}
        theme="ducks"
      />
    </group>
  );
}
