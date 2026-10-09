import { ArrowUpRight } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Vector3, type Camera, type Object3D } from "three";
import type { Point } from "../layout";
import { lakeTitleBox, positionPlaques, type PlaqueBox } from "../plaqueLayout";
import { Label } from "./SceneLabel";

export const LandmarkPlaques = createContext(
  new Map<string, { object: Object3D; width: number; height: number }>(),
);

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
  const calculatePosition = useCallback(
    (
      object: Object3D,
      camera: Camera,
      size: { width: number; height: number },
    ) => {
      plaques.set(name, { object, ...dimensions.current });
      const boxes: PlaqueBox[] = [...plaques].map(([key, value]) => {
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
    [plaques, name],
  );
  return (
    <Label
      persistent
      center
      position={point}
      zIndexRange={[18, 0]}
      calculatePosition={calculatePosition}
    >
      <a
        ref={registerAnchor}
        className={`landmark-link${theme ? ` ${theme}-link` : ""}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visit ${name} (opens in a new tab)`}
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
