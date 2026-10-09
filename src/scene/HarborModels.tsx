import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute, Group } from "three";
import type { AirportLayout, DockLayout, PierLayout, Point } from "../layout";
import { harborPoint } from "../layout";
import type { Selection } from "../types";
import { Label } from "./SceneLabel";

const roof = new BufferGeometry();
roof.setAttribute(
  "position",
  new Float32BufferAttribute(
    [
      -0.38, 0, -0.43, 0, 0.25, -0.43, -0.38, 0, 0.43, -0.38, 0, 0.43, 0, 0.25,
      -0.43, 0, 0.25, 0.43, 0, 0.25, -0.43, 0.38, 0, -0.43, 0.38, 0, 0.43, 0,
      0.25, -0.43, 0.38, 0, 0.43, 0, 0.25, 0.43, -0.38, 0, -0.43, 0.38, 0,
      -0.43, 0, 0.25, -0.43, 0.38, 0, 0.43, -0.38, 0, 0.43, 0, 0.25, 0.43,
    ],
    3,
  ),
);
roof.computeVertexNormals();

export function Tree({
  position,
  scale = 1,
}: {
  position: Point;
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.64, 5]} />
        <meshStandardMaterial color="#927e61" />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <coneGeometry args={[0.45, 1.1, 6]} />
        <meshStandardMaterial color="#728f73" />
      </mesh>
      <mesh position={[0, 1.32, 0]}>
        <coneGeometry args={[0.31, 0.8, 6]} />
        <meshStandardMaterial color="#9aaa85" />
      </mesh>
    </group>
  );
}

const hover = () => {
  document.body.style.cursor = "pointer";
};
const unhover = () => {
  document.body.style.cursor = "";
};
function Bollard({ position }: { position: Point }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.065, 0.095, 0.18, 6]} />
        <meshStandardMaterial color="#65756b" />
      </mesh>
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[0.2, 0.065, 0.08]} />
        <meshStandardMaterial color="#718077" />
      </mesh>
    </group>
  );
}

export function Dock({
  dock,
  selected,
  onSelect,
}: {
  dock: DockLayout;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  const active = selected.type === "catalog" && selected.id === dock.id;
  return (
    <>
      <group
        position={dock.center}
        rotation={[0, dock.rotation, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect({ type: "catalog", id: dock.id });
        }}
        onPointerOver={hover}
        onPointerOut={unhover}
      >
        {dock.branching && (
          <>
            <RoundedBox
              args={[1.8, 0.22, dock.depth + 1]}
              radius={0.05}
              smoothness={1}
              position={[0, 0.12, dock.depth / 2 - 0.2]}
            >
              <meshStandardMaterial color="#b89b6f" />
            </RoundedBox>
            {Array.from({ length: Math.ceil(dock.depth / 0.3) }, (_, i) => (
              <mesh key={i} position={[0, 0.235, i * 0.3]}>
                <boxGeometry args={[1.75, 0.01, 0.018]} />
                <meshStandardMaterial color="#927e5a" />
              </mesh>
            ))}
            {dock.piers.map((pier) => {
              const root = harborPoint(pier, 0, -1.1);
              const dx = root[0] - dock.center[0],
                dz = root[2] - dock.center[2];
              const x =
                dx * Math.cos(dock.rotation) - dz * Math.sin(dock.rotation);
              const z =
                dx * Math.sin(dock.rotation) + dz * Math.cos(dock.rotation);
              return (
                <RoundedBox
                  key={pier.id}
                  args={[Math.abs(x) + 0.8, 0.22, 0.72]}
                  radius={0.05}
                  smoothness={1}
                  position={[x / 2, 0.12, z]}
                >
                  <meshStandardMaterial color="#b89b6f" />
                </RoundedBox>
              );
            })}
          </>
        )}
        <RoundedBox
          args={[dock.width + 0.6, 0.3, 1.35]}
          radius={0.1}
          smoothness={1}
          position={[0, 0.08, -1.08]}
        >
          <meshStandardMaterial color="#ab9068" />
        </RoundedBox>
        {Array.from({ length: Math.ceil(dock.width / 0.3) }, (_, i) => (
          <mesh key={i} position={[-dock.width / 2 + i * 0.3, 0.235, -1.08]}>
            <boxGeometry args={[0.018, 0.01, 1.3]} />
            <meshStandardMaterial color="#8f7c5e" />
          </mesh>
        ))}
        <RoundedBox
          args={[1.4, 0.65, 0.9]}
          radius={0.04}
          smoothness={1}
          position={[-dock.width / 2 + 1, 0.58, -1.2]}
        >
          <meshStandardMaterial color="#e0d5b9" />
        </RoundedBox>
        <mesh
          geometry={roof}
          position={[-dock.width / 2 + 1, 0.92, -1.2]}
          scale={[2, 1.5, 1.3]}
        >
          <meshStandardMaterial color="#697e72" side={2} flatShading />
        </mesh>
        <Tree position={[dock.width / 2 - 0.4, 0.2, -1.3]} scale={0.7} />
        <Label center position={[0, 0.6, -4.4]} zIndexRange={[24, 0]}>
          <button
            className={`dock-label catalog-label ${active ? "selected" : ""}`}
            aria-label={`Catalog dock ${dock.catalog} · ${dock.piers.length} schemas`}
            onClick={() => onSelect({ type: "catalog", id: dock.id })}
          >
            <span>Catalog dock</span>
            <strong>{dock.catalog}</strong>
            <small>{dock.piers.length} schemas</small>
          </button>
        </Label>
      </group>
      {dock.piers.map((pier) => (
        <Pier
          key={pier.id}
          dock={pier}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function Pier({
  dock,
  selected,
  onSelect,
}: {
  dock: PierLayout;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  const expanded =
    (selected.type === "catalog" && selected.id === dock.catalog_id) ||
    (selected.type === "schema" && selected.id === dock.id) ||
    (selected.type === "table" &&
      dock.objects.some((o) => o.id === selected.id));
  const w = dock.width;
  const length = dock.depth;
  const posts = Array.from({ length: Math.ceil(length / 2.4) }, (_, i) =>
    Math.min(length - 0.5, 1 + i * 2.4),
  );
  return (
    <group
      position={dock.center}
      rotation={[0, dock.rotation, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: "schema", id: dock.id });
      }}
      onPointerOver={hover}
      onPointerOut={unhover}
    >
      <RoundedBox
        args={[w + 0.1, 0.32, 2.1]}
        radius={0.12}
        smoothness={2}
        position={[0, -0.06, -0.5]}
      >
        <meshStandardMaterial color={dock.branching ? "#b89b6f" : "#c5cfae"} />
      </RoundedBox>
      <RoundedBox
        args={[w, 0.22, length + 0.35]}
        radius={0.05}
        smoothness={1}
        position={[0, 0.14, (length - 0.35) / 2]}
      >
        <meshStandardMaterial color="#b89b6f" />
      </RoundedBox>
      {Array.from({ length: Math.ceil(length / 0.28) }, (_, i) => (
        <mesh key={i} position={[0, 0.255, i * 0.28]}>
          <boxGeometry args={[w - 0.08, 0.01, 0.018]} />
          <meshStandardMaterial color="#9e855f" />
        </mesh>
      ))}
      {[-w / 2, w / 2].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.13, length / 2]}>
            <boxGeometry args={[0.07, 0.14, length]} />
            <meshStandardMaterial color="#8d7857" />
          </mesh>
          {posts.map((z) => (
            <group key={z}>
              <mesh position={[x, -0.03, z]}>
                <cylinderGeometry args={[0.09, 0.12, 0.6, 6]} />
                <meshStandardMaterial color="#8f7958" />
              </mesh>
              <Bollard position={[x, 0.25, z]} />
            </group>
          ))}
        </group>
      ))}
      <mesh position={[-0.5, 0.22, -0.97]}>
        <boxGeometry args={[0.33, 0.35, 0.31]} />
        <meshStandardMaterial color="#ad8d61" />
      </mesh>
      <mesh position={[-0.5, 0.23, -0.805]}>
        <boxGeometry args={[0.018, 0.32, 0.015]} />
        <meshStandardMaterial color="#7f7557" />
      </mesh>
      {!dock.branching && <Tree position={[0.95, 0.1, -1.15]} scale={0.65} />}
      <Line
        points={[
          [-w / 2, 0.41, 0.8],
          [-w / 2 + 0.35, 0.3, 0.8],
          [-w / 2 + 0.7, 0.4, 0.8],
        ]}
        color="#e5d7ae"
        lineWidth={1}
      />
      <Label center position={[0, 1.1, length / 2]} zIndexRange={[20, 0]}>
        <button
          className={`dock-label schema-label ${expanded ? "selected" : ""}`}
          aria-label={`Schema pier ${dock.catalog}.${dock.schema}`}
          onClick={() => onSelect({ type: "schema", id: dock.id })}
        >
          <span>Schema pier</span>
          <strong>{dock.schema}</strong>
          <small>{dock.catalog}</small>
        </button>
      </Label>
    </group>
  );
}

export function Airport({
  airport,
  selected,
  onSelect,
  clock,
  reduced,
}: {
  airport: AirportLayout;
  selected: Selection;
  onSelect: (s: Selection) => void;
  clock: RefObject<number>;
  reduced: boolean;
}) {
  const sock = useRef<Group>(null);
  useFrame(() => {
    if (sock.current)
      sock.current.rotation.y = reduced
        ? -0.5
        : -0.5 + Math.sin(clock.current / 7000) * 0.16;
  });
  const active = selected.type === "airport" && selected.id === airport.id;
  const exporting = airport.role === "export";
  return (
    <group
      position={airport.center}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: "airport", id: airport.id });
      }}
      onPointerOver={hover}
      onPointerOut={unhover}
    >
      <RoundedBox
        args={[4.3 + airport.apronExtra, 0.38, 6.5]}
        radius={0.16}
        smoothness={2}
        position={[(airport.side * airport.apronExtra) / 2, -0.05, 0]}
      >
        <meshStandardMaterial color="#c7d0b2" />
      </RoundedBox>
      <RoundedBox
        args={[1.35, 0.08, 4.8]}
        radius={0.025}
        smoothness={1}
        position={[-0.55, 0.2, 0]}
      >
        <meshStandardMaterial color="#768a7d" />
      </RoundedBox>
      {[-1.2, -0.6, 0, 0.6, 1.2].map((z) => (
        <mesh key={z} position={[-0.55, 0.247, z]}>
          <boxGeometry args={[0.055, 0.009, 0.3]} />
          <meshBasicMaterial color="#f2eddc" />
        </mesh>
      ))}
      {[-1.95, 1.95].flatMap((z) =>
        [-0.35, -0.14, 0.14, 0.35].map((x) => (
          <mesh key={`${x}:${z}`} position={[-0.55 + x, 0.248, z]}>
            <boxGeometry args={[0.095, 0.009, 0.42]} />
            <meshBasicMaterial color="#e5e4cd" />
          </mesh>
        )),
      )}
      {[-2.25, 2.25].flatMap((z) =>
        [-1.3, 0.2].map((x) => (
          <mesh key={`${x}:${z}`} position={[x, 0.29, z]}>
            <sphereGeometry args={[0.055, 6, 4]} />
            <meshBasicMaterial color="#dbc78b" />
          </mesh>
        )),
      )}
      <RoundedBox
        args={[1.05, 0.67, 1.65]}
        radius={0.035}
        smoothness={1}
        position={[1.05, 0.47, 0.28]}
      >
        <meshStandardMaterial color="#e5dfca" />
      </RoundedBox>
      <mesh position={[1.05, 0.83, 0.28]}>
        <boxGeometry args={[1.18, 0.1, 1.8]} />
        <meshStandardMaterial color="#829485" />
      </mesh>
      <mesh position={[1.05, 0.51, 1.12]}>
        <boxGeometry args={[0.72, 0.33, 0.025]} />
        <meshStandardMaterial color="#8daaa1" />
      </mesh>
      <mesh position={[1.08, 0.93, -1.17]}>
        <boxGeometry args={[0.38, 1.45, 0.4]} />
        <meshStandardMaterial color="#d8d3be" />
      </mesh>
      <mesh position={[1.08, 1.58, -1.17]}>
        <boxGeometry args={[0.65, 0.42, 0.65]} />
        <meshStandardMaterial color="#6f938d" />
      </mesh>
      <mesh position={[1.08, 1.84, -1.17]}>
        <boxGeometry args={[0.77, 0.1, 0.77]} />
        <meshStandardMaterial color="#e8e4cf" />
      </mesh>
      <mesh position={[1.62, 0.92, 2.17]}>
        <cylinderGeometry args={[0.035, 0.045, 1.55, 6]} />
        <meshStandardMaterial color="#819180" />
      </mesh>
      <group ref={sock} position={[1.62, 1.65, 2.17]} rotation={[0, -0.5, 0]}>
        <mesh
          position={[0.27, -0.045, 0]}
          rotation={[0, 0, -Math.PI / 2 + 0.15]}
        >
          <coneGeometry args={[0.13, 0.62, 7, 1, true]} />
          <meshStandardMaterial color="#d48d69" side={2} />
        </mesh>
        <mesh
          position={[0.16, -0.025, 0]}
          rotation={[0, 0, -Math.PI / 2 + 0.15]}
        >
          <cylinderGeometry args={[0.095, 0.105, 0.075, 7, 1, true]} />
          <meshStandardMaterial color="#f8ead5" side={2} />
        </mesh>
      </group>
      <Label
        center
        position={[airport.side * 1.2, 0.6, -4.3]}
        zIndexRange={[20, 0]}
      >
        <button
          className={`dock-label airport-label ${active ? "selected" : ""}`}
          aria-label={`External ${exporting ? "destination" : "source"} ${airport.name} Airport`}
          onClick={() => onSelect({ type: "airport", id: airport.id })}
        >
          <span>{exporting ? "Export destination" : "External source"}</span>
          <strong>{airport.name}</strong>
          <small>{exporting ? "Export airport" : "Source airport"}</small>
        </button>
      </Label>
    </group>
  );
}
