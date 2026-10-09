import {
  Component,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { Group, Mesh, OrthographicCamera, Vector3 } from "three";
import type { OrbitControls as Controls } from "three-stdlib";
import type { Attempt, Selection } from "./types";
import type { LakeLayout, Point } from "./layout";
import { CAMERA_OFFSET, cameraFit, lighthousePoint } from "./layout";
import { isOverdue } from "./state";
import { makePath, positionAt, type MotionPath } from "./motion";
import { separateTraffic } from "./traffic";
import { Label, LabelPortal } from "./scene/SceneLabel";
import { Dock, Airport } from "./scene/HarborModels";
import { PaperPlane, PaperShip } from "./scene/PaperModels";
import { LakeSurface } from "./scene/LakeSurface";
import {
  EightFDEOctopus,
  LakeSentryLighthouse,
  PondPilotDucks,
} from "./scene/LakeLandmarks";
import { expandVessels, flightSelection, selectedDestination } from "./vessels";

const colors = {
  observed: "#668e82",
  historical: "#829b90",
  configured: "#8da395",
  unknown: "#a8b0ac",
};
export interface CameraAction {
  kind: "zoom-in" | "zoom-out" | "rotate" | "reset" | "focus";
  sequence: number;
  target?: Point;
}

function CameraRig({
  action,
  layout,
}: {
  action: CameraAction | null;
  layout: LakeLayout;
}) {
  const controls = useRef<Controls>(null);
  const { camera, size } = useThree();
  const fit = cameraFit(layout, size.width, size.height);
  const scale = Math.max(
    1,
    (layout.bounds.max[0] - layout.bounds.min[0]) / 35,
    (layout.bounds.max[2] - layout.bounds.min[2]) / 25,
  );
  function reset() {
    const c = camera as OrthographicCamera;
    const target = new Vector3(
      (layout.bounds.min[0] + layout.bounds.max[0]) / 2,
      2,
      (layout.bounds.min[2] + layout.bounds.max[2]) / 2,
    );
    c.position
      .copy(target)
      .add(new Vector3(...CAMERA_OFFSET).multiplyScalar(scale));
    c.lookAt(target);
    c.zoom = fit;
    c.far = Math.max(200, 160 * scale);
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
    }
    c.updateProjectionMatrix();
  }
  useEffect(reset, [camera, size.width, size.height, layout]);
  useEffect(() => {
    if (!action || !controls.current) return;
    const c = camera as OrthographicCamera,
      ctrl = controls.current;
    if (action.kind.startsWith("zoom"))
      c.zoom = Math.max(
        fit * 0.4,
        Math.min(90, c.zoom * (action.kind === "zoom-in" ? 1.2 : 1 / 1.2)),
      );
    if (action.kind === "rotate") {
      const offset = c.position.clone().sub(ctrl.target);
      offset.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
      c.position.copy(ctrl.target).add(offset);
    }
    if (action.kind === "reset") reset();
    if (action.kind === "focus" && action.target) {
      const target = new Vector3(...action.target),
        offset = c.position.clone().sub(ctrl.target);
      ctrl.target.copy(target);
      c.position.copy(target).add(offset);
      c.zoom = Math.max(fit, 34);
    }
    c.updateProjectionMatrix();
    ctrl.update();
  }, [action]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      enableRotate
      minPolarAngle={0.35}
      maxPolarAngle={1.25}
      minZoom={fit * 0.4}
      maxZoom={90}
    />
  );
}

function Vessel({
  attempt: a,
  destinationId,
  layout,
  clock,
  selected,
  reduced,
  onSelect,
  path,
  traffic,
  instanceKey,
}: {
  attempt: Attempt;
  destinationId?: string;
  layout: LakeLayout;
  clock: RefObject<number>;
  selected: boolean;
  reduced: boolean;
  onSelect: (s: Selection) => void;
  path: MotionPath;
  traffic: RefObject<Map<string, Vector3>>;
  instanceKey: string;
}) {
  const group = useRef<Group>(null),
    paper = useRef<Group>(null),
    shadow = useRef<Mesh>(null),
    wake = useRef<Group>(null);
  const landing = layout.objects.find((o) => o.id === destinationId);
  const landingName = landing
    ? `${landing.catalog}.${landing.schema_name}.${landing.name}`
    : destinationId;
  const tint =
    a.phase === "failed"
      ? "#e3a189"
      : isOverdue(a, clock.current)
        ? "#e2c28a"
        : a.collection_stale_at !== null
          ? "#a9b7ae"
          : "#ffffff";
  const moving =
    a.phase === "running" && a.collection_stale_at === null && !reduced;
  useFrame(() => {
    if (!group.current) return;
    const at = reduced ? (a.started_at ?? clock.current) : clock.current;
    const motion = positionAt(a, path, at);
    const position = traffic.current.get(instanceKey) ?? motion.position;
    group.current.position.copy(position);
    group.current.rotation.y = motion.heading;
    if (paper.current) {
      paper.current.rotation.z =
        a.kind === "plane" && moving
          ? Math.sin(at / 3700 + a.id.length) * 0.11
          : 0;
      paper.current.rotation.x =
        a.kind === "ship" && moving
          ? Math.sin(at / 2400 + a.id.length) * 0.025
          : 0;
      paper.current.position.y = moving
        ? Math.sin(at / 1800 + a.id.length) * 0.018
        : 0;
    }
    if (shadow.current) {
      shadow.current.position.set(position.x, 0.09, position.z);
      shadow.current.rotation.z = -motion.heading;
      shadow.current.scale.setScalar(1 + position.y * 0.12);
    }
    if (wake.current) {
      wake.current.visible = moving && a.kind === "ship";
      wake.current.position.copy(position).setY(0.09);
      wake.current.rotation.y = motion.heading;
      wake.current.scale.x = 1 + Math.sin(at / 1200) * 0.04;
    }
  });
  const points = useMemo(() => path.curve.getSpacedPoints(55), [path]);
  return (
    <>
      {a.route.evidence !== "unknown" &&
        (selected || a.phase === "running") && (
          <Line
            points={points}
            color={selected ? "#d37c62" : colors[a.route.evidence]}
            lineWidth={selected ? 1.8 : 0.8}
            transparent
            opacity={selected ? 0.8 : 0.36}
            dashed={a.route.evidence !== "observed"}
            dashSize={a.route.evidence === "historical" ? 0.09 : 0.3}
            gapSize={0.18}
          />
        )}
      {selected &&
        a.route.source_ids.slice(a.kind === "buoy" ? 0 : 1).map((id) => {
          const o = layout.objects.find((x) => x.id === id);
          return (
            o && (
              <Line
                key={id}
                points={[new Vector3(...o.position), path.from]}
                color="#d37c62"
                lineWidth={1}
              />
            )
          );
        })}
      {a.kind === "plane" && (
        <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.6, 24]} />
          <meshBasicMaterial
            color="#406f5d"
            transparent
            opacity={0.12}
            depthWrite={false}
          />
        </mesh>
      )}
      <group ref={wake} visible={false}>
        <Line
          points={[
            [-0.32, 0, -0.35],
            [-0.6, 0, -0.85],
            [-0.8, 0, -1.3],
          ]}
          color="#d3e5d6"
          lineWidth={1.2}
          transparent
          opacity={0.5}
        />
        <Line
          points={[
            [0.32, 0, -0.35],
            [0.6, 0, -0.85],
            [0.8, 0, -1.3],
          ]}
          color="#d3e5d6"
          lineWidth={1.2}
          transparent
          opacity={0.5}
        />
        <Line
          points={[
            [-0.25, 0, -0.75],
            [0, 0, -0.84],
            [0.25, 0, -0.75],
          ]}
          color="#bfdac7"
          lineWidth={1}
          transparent
          opacity={0.45}
        />
      </group>
      <group
        ref={group}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(flightSelection(a, destinationId));
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <group ref={paper}>
          {a.kind === "plane" ? (
            <PaperPlane tint={tint} />
          ) : a.kind === "ship" ? (
            <PaperShip tint={tint} />
          ) : (
            <>
              <mesh position={[0, 0.02, 0]}>
                <cylinderGeometry args={[0.25, 0.35, 0.22, 8]} />
                <meshStandardMaterial color="#d5bb83" />
              </mesh>
              <mesh position={[0, 0.27, 0]}>
                <cylinderGeometry args={[0.045, 0.05, 0.35, 6]} />
                <meshStandardMaterial color="#718a7b" />
              </mesh>
              <mesh position={[0, 0.48, 0]}>
                <octahedronGeometry args={[0.16]} />
                <meshStandardMaterial color={tint} />
              </mesh>
            </>
          )}
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]}>
          <ringGeometry
            args={[selected ? 0.67 : 0.43, selected ? 0.72 : 0.445, 36]}
          />
          <meshBasicMaterial
            color={selected ? "#d37c62" : "#c8e0d6"}
            transparent
            opacity={selected ? 0.8 : 0.45}
            depthWrite={false}
          />
        </mesh>
        {(a.kind === "plane" || selected || a.phase === "failed") && (
          <Label center position={[0, 1.18, 0]} zIndexRange={[25, 0]}>
            <button
              className={`${a.kind === "plane" ? "plane-label" : "vessel-label"} ${selected ? "selected" : ""} ${a.phase === "failed" ? "danger" : ""}`}
              aria-label={
                a.kind === "plane"
                  ? `Inspect plane to ${landingName ?? "unresolved destination"}`
                  : undefined
              }
              aria-pressed={selected}
              onClick={() => onSelect(flightSelection(a, destinationId))}
            >
              {a.phase === "failed" ? "Failed · " : ""}
              {a.kind === "plane" ? (
                <>
                  <small>↘ {landing?.schema_name ?? "Landing"}</small>
                  {landing?.name ?? "Unresolved"}
                </>
              ) : (
                a.name
              )}
            </button>
          </Label>
        )}
      </group>
    </>
  );
}

function VesselTraffic({
  attempts,
  layout,
  clock,
  reduced,
  selected,
  onSelect,
}: {
  attempts: Attempt[];
  layout: LakeLayout;
  clock: RefObject<number>;
  reduced: boolean;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  const cache = useMemo(() => new Map<string, MotionPath>(), [layout]);
  const plans = useMemo(
    () =>
      expandVessels(attempts.slice(0, 200)).map((instance) => {
        const key = `${instance.key}:${instance.attempt.route.version}`;
        let path = cache.get(key);
        if (!path) {
          path = makePath(
            instance.attempt,
            layout.objects,
            layout.airports,
            layout.piers,
            instance.destinationId,
            layout,
          );
          cache.set(key, path);
        }
        return { ...instance, path };
      }),
    [attempts, layout, cache],
  );
  const traffic = useRef(new Map<string, Vector3>());
  useFrame(() => {
    traffic.current = separateTraffic(
      plans.map(({ key, attempt: a, path }) => ({
        key,
        kind: a.kind,
        position: positionAt(
          a,
          path,
          reduced ? (a.started_at ?? clock.current) : clock.current,
        ).position,
        fixed:
          reduced ||
          a.kind === "buoy" ||
          a.phase !== "running" ||
          a.collection_stale_at !== null,
      })),
      layout.water,
    );
  }, -1);
  return (
    <>
      {plans.map(({ key, attempt: a, destinationId, path }) => (
        <Vessel
          key={key}
          instanceKey={key}
          attempt={a}
          destinationId={destinationId}
          path={path}
          traffic={traffic}
          layout={layout}
          clock={clock}
          reduced={reduced}
          selected={
            selected.type === "attempt" &&
            selected.id === a.id &&
            (a.kind !== "plane" ||
              destinationId === selectedDestination(a, selected))
          }
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        The 3D scene is unavailable. All task details remain accessible in the
        activity list.
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function LakeScene({
  layout,
  attempts,
  selected,
  onSelect,
  clock,
  reduced,
  eggs,
  action,
}: {
  layout: LakeLayout;
  attempts: Attempt[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  clock: RefObject<number>;
  reduced: boolean;
  eggs: boolean;
  action: CameraAction | null;
}) {
  // Stable DOM attachment prevents HTML labels from rebuilding when events connect.
  const portal = useRef<HTMLDivElement>(null!);
  return (
    <div
      ref={portal}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <SceneBoundary>
        <Canvas
          orthographic
          shadows={false}
          camera={{ position: CAMERA_OFFSET, zoom: 16, near: 0.1, far: 200 }}
          dpr={[1, 1.5]}
          fallback={
            <div className="scene-fallback">
              WebGL is unavailable. Use the activity list below.
            </div>
          }
        >
          <LabelPortal.Provider value={portal}>
            <color attach="background" args={["#f0f3eb"]} />
            <ambientLight intensity={1.35} />
            <directionalLight
              position={[8, 18, 9]}
              intensity={2}
              color="#fff9ed"
            />
            <CameraRig action={action} layout={layout} />
            <LakeSurface layout={layout} clock={clock} reduced={reduced} />
            <LakeSentryLighthouse
              point={lighthousePoint(layout)}
              clock={clock}
              reduced={reduced}
            />
            {layout.docks.map((dock) => (
              <Dock
                key={dock.id}
                dock={dock}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
            {layout.airports.map((airport) => (
              <Airport
                key={airport.id}
                airport={airport}
                selected={selected}
                onSelect={onSelect}
                clock={clock}
                reduced={reduced}
              />
            ))}
            <VesselTraffic
              attempts={attempts}
              layout={layout}
              clock={clock}
              reduced={reduced}
              selected={selected}
              onSelect={onSelect}
            />
            {eggs && (
              <>
                <PondPilotDucks
                  clock={clock}
                  reduced={reduced}
                  water={layout.water}
                />
                <EightFDEOctopus
                  clock={clock}
                  reduced={reduced}
                  water={layout.water}
                />
              </>
            )}
          </LabelPortal.Provider>
        </Canvas>
      </SceneBoundary>
    </div>
  );
}
