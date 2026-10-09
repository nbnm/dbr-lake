import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute, Group } from "three";
import type { AirportLayout, DockLayout, PierLayout, Point } from "../layout";
import type { Selection } from "../types";
import { BERTH_SPACING } from "../navigation";
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
        rotation={[0, dock.direction === 1 ? 0 : Math.PI, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect({ type: "catalog", id: dock.id });
        }}
        onPointerOver={hover}
        onPointerOut={unhover}
      >
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
            <small>
              {dock.piers.length} schemas · {dock.objects.length} tables
            </small>
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
  return (
    <group
      position={dock.center}
      rotation={[0, dock.direction === 1 ? 0 : Math.PI, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: "schema", id: dock.id });
      }}
      onPointerOver={hover}
      onPointerOut={unhover}
    >
      <RoundedBox
        args={[w + 0.5, 0.32, 2.1]}
        radius={0.12}
        smoothness={2}
        position={[0, -0.06, -0.5]}
      >
        <meshStandardMaterial color="#c5cfae" />
      </RoundedBox>
      <RoundedBox
        args={[w + 0.2, 0.16, 0.72]}
        radius={0.05}
        smoothness={1}
        position={[0, 0.14, 0.72]}
      >
        <meshStandardMaterial color="#b89b6f" />
      </RoundedBox>
      {Array.from({ length: Math.ceil(w / 0.24) }, (_, i) => (
        <mesh key={i} position={[-w / 2 + i * 0.24, 0.225, 0.72]}>
          <boxGeometry args={[0.018, 0.01, 0.69]} />
          <meshStandardMaterial color="#9e855f" />
        </mesh>
      ))}
      <mesh position={[0, 0.13, 0.96]}>
        <boxGeometry args={[w + 0.3, 0.14, 0.09]} />
        <meshStandardMaterial color="#8d7857" />
      </mesh>
      {[-w / 2, w / 2].map((x) => (
        <group key={x}>
          <mesh position={[x, -0.03, 0.88]}>
            <cylinderGeometry args={[0.09, 0.12, 0.6, 6]} />
            <meshStandardMaterial color="#8f7958" />
          </mesh>
          <Bollard position={[x, 0.23, 0.78]} />
        </group>
      ))}
      {dock.objects.slice(0, dock.slots).map((table, i) => {
        const x = (i - (dock.slots - 1) / 2) * BERTH_SPACING;
        const tint = ["#d9d7b8", "#a9bbb0", "#d6b89b"][i % 3];
        return (
          <group
            key={table.id}
            position={[x, 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ type: "table", id: table.id });
            }}
          >
            <mesh position={[0, 0.05, 1.52]}>
              <boxGeometry args={[0.37, 0.2, 1.27]} />
              <meshStandardMaterial color="#bda377" />
            </mesh>
            {Array.from({ length: 6 }, (_, n) => (
              <mesh key={n} position={[0, 0.154, 1.04 + n * 0.19]}>
                <boxGeometry args={[0.35, 0.01, 0.018]} />
                <meshStandardMaterial color="#927e5a" />
              </mesh>
            ))}
            <mesh position={[0.14, -0.07, 1.94]}>
              <cylinderGeometry args={[0.065, 0.075, 0.47, 5]} />
              <meshStandardMaterial color="#8f7958" />
            </mesh>
            <Bollard position={[0.12, 0.17, 1.78]} />
            <RoundedBox
              args={[0.65, 0.48, 0.74]}
              radius={0.025}
              smoothness={1}
              position={[0, 0.37, -0.14]}
            >
              <meshStandardMaterial color={tint} />
            </RoundedBox>
            <mesh position={[0, 0.61, -0.14]} geometry={roof}>
              <meshStandardMaterial color="#697e72" flatShading side={2} />
            </mesh>
            <mesh position={[0, 0.38, 0.241]}>
              <boxGeometry args={[0.24, 0.28, 0.02]} />
              <meshStandardMaterial color="#7b8d7b" />
            </mesh>
            <mesh position={[0, 0.38, 0.254]}>
              <boxGeometry args={[0.012, 0.26, 0.012]} />
              <meshStandardMaterial color="#bccbb5" />
            </mesh>
            {expanded && (
              <Label center position={[0, 0.5, 2.2]} zIndexRange={[22, 0]}>
                <button
                  className={`berth-label ${selected.type === "table" && selected.id === table.id ? "selected" : ""}`}
                  onClick={() => onSelect({ type: "table", id: table.id })}
                >
                  {table.name}
                </button>
              </Label>
            )}
          </group>
        );
      })}
      <mesh position={[-w / 2 + 0.15, 0.22, -0.97]}>
        <boxGeometry args={[0.33, 0.35, 0.31]} />
        <meshStandardMaterial color="#ad8d61" />
      </mesh>
      <mesh position={[-w / 2 + 0.15, 0.23, -0.805]}>
        <boxGeometry args={[0.018, 0.32, 0.015]} />
        <meshStandardMaterial color="#7f7557" />
      </mesh>
      <Tree position={[w / 2 - 0.2, 0.1, -0.9]} scale={0.65} />
      <Line
        points={[
          [-w / 2, 0.41, 0.8],
          [-w / 2 + 0.35, 0.3, 0.8],
          [-w / 2 + 0.7, 0.4, 0.8],
        ]}
        color="#e5d7ae"
        lineWidth={1}
      />
      <Label center position={[0, 1.1, 1.5]} zIndexRange={[20, 0]}>
        <button
          className={`dock-label schema-label ${expanded ? "selected" : ""}`}
          aria-label={`Schema pier ${dock.catalog}.${dock.schema} · ${dock.objects.length} tables`}
          onClick={() => onSelect({ type: "schema", id: dock.id })}
        >
          <span>Schema pier</span>
          <strong>{dock.schema}</strong>
          <small>
            {dock.objects.length}{" "}
            {dock.objects.length === 1 ? "table" : "tables"}
            {dock.objects.length > dock.slots
              ? ` · ${dock.slots} grouped berths`
              : ""}
          </small>
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
  const tableCount = (exporting ? airport.source_ids : airport.target_ids)
    .length;
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
          aria-label={`External ${exporting ? "destination" : "source"} ${airport.name} Airport · ${tableCount} ${exporting ? "source" : "destination"} ${tableCount === 1 ? "berth" : "berths"}`}
          onClick={() => onSelect({ type: "airport", id: airport.id })}
        >
          <span>{exporting ? "Export destination" : "External source"}</span>
          <strong>{airport.name}</strong>
          <small>
            Airport · {tableCount} {exporting ? "source" : "destination"}{" "}
            {tableCount === 1 ? "berth" : "berths"}
          </small>
        </button>
      </Label>
    </group>
  );
}
