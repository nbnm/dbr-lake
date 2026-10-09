import { ArrowUpRight } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Vector3, type Camera, type Object3D } from "three";
import type { Point } from "../layout";
import { lakeTitleBox, positionPlaques, type PlaqueBox } from "../plaqueLayout";
import { Label } from "./SceneLabel";

export const LandmarkPlaques = createContext(
  new Map<string, { object: Object3D; width: number; height: number }>(),
);

const LandmarkHover = createContext({
  visible: false,
  enterCaption: () => {},
  leaveCaption: () => {},
  focus: () => {},
  blur: () => {},
});

type HoverSource = "model" | "caption" | "focus";

export function LandmarkModel({ children, ...props }: ComponentProps<"group">) {
  const [visible, setVisible] = useState(false);
  const active = useRef({ model: false, caption: false, focus: false });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const show = useCallback((source: HoverSource) => {
    active.current[source] = true;
    clearTimeout(hideTimer.current);
    setVisible(true);
    document.body.style.cursor = "pointer";
  }, []);
  const hide = useCallback((source: HoverSource) => {
    active.current[source] = false;
    clearTimeout(hideTimer.current);
    document.body.style.cursor = "";
    if (Object.values(active.current).some(Boolean)) return;
    // Bridge the small gap between a moving model and its clickable caption.
    hideTimer.current = setTimeout(() => {
      if (!Object.values(active.current).some(Boolean)) setVisible(false);
    }, 120);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <group
      {...props}
      onPointerOver={(event) => {
        event.stopPropagation();
        show("model");
      }}
      onPointerOut={() => hide("model")}
    >
      <LandmarkHover.Provider
        value={{
          visible,
          enterCaption: () => show("caption"),
          leaveCaption: () => hide("caption"),
          focus: () => show("focus"),
          blur: () => hide("focus"),
        }}
      >
        {children}
      </LandmarkHover.Provider>
    </group>
  );
}

export function LandmarkLink({
  name,
  href,
  point,
  theme,
  logo,
}: {
  name: string;
  href: string;
  point: Point;
  theme?: "lighthouse" | "ducks" | "octopus";
  logo?: string;
}) {
  const plaques = useContext(LandmarkPlaques);
  const { visible, enterCaption, leaveCaption, focus, blur } =
    useContext(LandmarkHover);
  const observer = useRef<ResizeObserver | null>(null);
  const dimensions = useRef({ width: 100, height: 36 });
  const registerAnchor = useCallback((link: HTMLAnchorElement | null) => {
    observer.current?.disconnect();
    if (link) {
      const update = () => {
        dimensions.current = {
          width: link.offsetWidth,
          height: link.offsetHeight,
        };
      };
      update();
      observer.current = new ResizeObserver(update);
      observer.current.observe(link);
    }
  }, []);
  useEffect(
    () => () => {
      plaques.delete(name);
    },
    [plaques, name],
  );
  useEffect(() => {
    if (!visible) plaques.delete(name);
  }, [visible, plaques, name]);
  const calculatePosition = useCallback(
    (
      object: Object3D,
      camera: Camera,
      size: { width: number; height: number },
    ) => {
      if (visible) plaques.set(name, { object, ...dimensions.current });
      else plaques.delete(name);
      // Keep the hidden caption positioned too, so revealing it never flashes
      // underneath the title while waiting for the next scene frame.
      const positioned = new Map(plaques);
      positioned.set(name, { object, ...dimensions.current });
      const boxes: PlaqueBox[] = [...positioned].map(([key, value]) => {
        value.object.updateWorldMatrix(true, false);
        const p = new Vector3()
          .setFromMatrixPosition(value.object.matrixWorld)
          .project(camera);
        return {
          key,
          x: ((p.x + 1) * size.width) / 2,
          y: ((1 - p.y) * size.height) / 2,
          width: value.width,
          height: value.height,
        };
      });
      boxes.push(lakeTitleBox(size.width, size.height));
      return positionPlaques(boxes, size.width, size.height).get(name)!;
    },
    [plaques, name, visible],
  );
  return (
    <Label
      persistent
      center
      position={point}
      zIndexRange={[18, 0]}
      calculatePosition={calculatePosition}
      style={{ pointerEvents: "none" }}
    >
      <a
        ref={registerAnchor}
        className={`landmark-link${visible ? " is-visible" : ""}${theme ? ` ${theme}-link` : ""}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visit ${name} (opens in a new tab)`}
        onPointerEnter={enterCaption}
        onPointerLeave={leaveCaption}
        onFocus={focus}
        onBlur={blur}
        onClick={(event) => event.stopPropagation()}
      >
        {logo ? (
          <img className="landmark-wordmark" src={logo} alt={name} />
        ) : (
          <strong>{name}</strong>
        )}
        <ArrowUpRight size={12} aria-hidden="true" />
      </a>
    </Label>
  );
}
