import { useEffect, useMemo } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
import {
  DoubleSide,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import type { LakeLayout } from "../layout";
import { canadianFlag } from "../landmarks";
import { Label } from "./SceneLabel";
import canadianFlagTexture from "../assets/canada.png";

export function CanadianFlagpole({
  water,
  reduced,
}: {
  water: LakeLayout["water"];
  reduced: boolean;
}) {
  const { point, width, height, poleHeight } = canadianFlag(water);
  const source = useLoader(TextureLoader, canadianFlagTexture);
  const texture = useMemo(() => {
    const result = source.clone();
    result.colorSpace = SRGBColorSpace;
    result.needsUpdate = true;
    return result;
  }, [source]);
  const cloth = useMemo(() => {
    const geometry = new PlaneGeometry(width, height, 28, 10);
    geometry.translate(width / 2, 0, 0);
    return {
      geometry,
      rest: Float32Array.from(geometry.attributes.position.array),
    };
  }, [width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => cloth.geometry.dispose(), [cloth]);
  useFrame(({ clock }) => {
    const positions = cloth.geometry.attributes.position;
    const phase = reduced ? 0 : clock.elapsedTime * 1.6;
    for (let i = 0; i < positions.count; i++) {
      const x = cloth.rest[i * 3],
        y = cloth.rest[i * 3 + 1];
      const u = x / width;
      positions.setXYZ(
        i,
        x,
        y + Math.sin(u * 8 - phase) * u * height * 0.025,
        Math.sin(u * 7 - phase + y / height) * u * width * 0.055,
      );
    }
    positions.needsUpdate = true;
  });
  return (
    <group name="canadian-flagpole" position={point}>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.62, 0.8, 0.24, 12]} />
        <meshStandardMaterial color="#d8d6c4" roughness={0.9} />
      </mesh>
      <mesh position={[0, poleHeight / 2, 0]}>
        <cylinderGeometry args={[0.055, 0.1, poleHeight, 12]} />
        <meshStandardMaterial
          color="#edeee6"
          metalness={0.35}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, poleHeight, 0]}>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshStandardMaterial
          color="#c7b17d"
          metalness={0.35}
          roughness={0.5}
        />
      </mesh>
      <Line
        points={[
          [0.085, 0.4, 0.06],
          [0.085, poleHeight - 0.25, 0.06],
        ]}
        color="#b6b6a7"
        lineWidth={0.6}
      />
      {/* A yaw-facing cloth keeps the maple leaf readable from both overviews. */}
      <Billboard
        position={[0, poleHeight - height / 2 - 0.25, 0]}
        follow
        lockX
        lockZ
      >
        <mesh geometry={cloth.geometry} position={[0.09, 0, 0]}>
          <meshBasicMaterial
            map={texture}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
      <Label persistent center position={[0, poleHeight + 0.4, 0]}>
        <span
          className="scene-accessible-description"
          role="img"
          aria-label="Canadian flag on a shore-side flagpole"
        />
      </Label>
    </group>
  );
}
