import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
import { Group, SRGBColorSpace, TextureLoader, type Texture } from "three";
import type { LakeLayout } from "../layout";
import { t1aBackdrop, zeppelinDimensions, zeppelinPose } from "../landmarks";
import { Label } from "./SceneLabel";

const ALCHEMIST_URL = "https://getalchemist.io/";
const T1A_URL = "https://t1a.com/";

function useBrandTextures(paths: string[]) {
  const sources = useLoader(TextureLoader, paths);
  const textures = useMemo(
    () =>
      sources.map((source) => {
        const texture = source.clone();
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      }),
    [sources],
  );
  useEffect(
    () => () => textures.forEach((texture) => texture.dispose()),
    [textures],
  );
  return textures;
}

function LogoPrint({
  texture,
  width,
  height,
}: {
  texture: Texture;
  width: number;
  height: number;
}) {
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.05}
        toneMapped={false}
      />
    </mesh>
  );
}

function openBrand(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

const pointer = {
  onPointerOver: () => {
    document.body.style.cursor = "pointer";
  },
  onPointerOut: () => {
    document.body.style.cursor = "";
  },
};

export function AlchemistZeppelin({
  water,
  reduced,
}: {
  water: LakeLayout["water"];
  reduced: boolean;
}) {
  const airship = useRef<Group>(null);
  const [wordmark, mark] = useBrandTextures([
    "/brands/alchemist.svg",
    "/brands/alchemist-mark.svg",
  ]);
  const { length: l, radius: r, gondolaDrop } = zeppelinDimensions(water);
  const initial = zeppelinPose(water, 0, reduced);
  const ribs = useMemo(
    () =>
      [-0.34, -0.19, 0, 0.19, 0.34].map((fraction) => {
        const radius = r * Math.sqrt(1 - (fraction * 2) ** 2) + 0.007;
        return Array.from({ length: 33 }, (_, i) => {
          const angle = (i / 32) * Math.PI * 2;
          return [
            fraction * l,
            Math.sin(angle) * radius,
            Math.cos(angle) * radius,
          ] as [number, number, number];
        });
      }),
    [l, r],
  );
  useFrame(({ clock }) => {
    if (!airship.current) return;
    const pose = zeppelinPose(water, clock.elapsedTime * 1000, reduced);
    airship.current.position.set(...pose.point);
    airship.current.rotation.set(0, pose.heading, pose.roll);
  });
  return (
    <group
      ref={airship}
      name="alchemist-zeppelin"
      position={initial.point}
      rotation={[0, initial.heading, initial.roll]}
      onClick={(event) => {
        event.stopPropagation();
        openBrand(ALCHEMIST_URL);
      }}
      {...pointer}
    >
      <mesh scale={[l / 2, r, r]}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshStandardMaterial color="#355c4d" roughness={0.85} flatShading />
      </mesh>
      {ribs.map((points, i) => (
        <Line key={i} points={points} color="#65836d" lineWidth={0.65} />
      ))}
      {/* Outward-facing copies keep the official wordmark readable from either bank. */}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[0.1 * l, 0.06 * r, side * (r + 0.02)]}
          rotation={[0, side === -1 ? Math.PI : 0, 0]}
        >
          <LogoPrint
            texture={wordmark}
            width={l * 0.61}
            height={(l * 0.61 * 44) / 444}
          />
        </group>
      ))}
      {/* Four stabilizing tail fins and a small suspended passenger gondola. */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle) => (
        <group key={angle} rotation={[angle, 0, 0]}>
          <mesh position={[-l * 0.38, r * 0.64, 0]} rotation={[0, 0, -0.25]}>
            <boxGeometry args={[l * 0.2, r * 0.92, r * 0.07]} />
            <meshStandardMaterial color="#a5bb9a" flatShading />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[-l * 0.39, r * 0.7, side * r * 0.04]}
          rotation={[0, side === -1 ? Math.PI : 0, 0]}
        >
          <LogoPrint
            texture={mark}
            width={r * 0.55}
            height={(r * 0.55 * 44) / 55}
          />
        </group>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * l * 0.08, -r - gondolaDrop * 0.18, 0]}
        >
          <boxGeometry args={[0.045, gondolaDrop * 0.4, 0.045]} />
          <meshStandardMaterial color="#7d8e79" />
        </mesh>
      ))}
      <mesh position={[0.02 * l, -r - gondolaDrop * 0.62, 0]}>
        <boxGeometry args={[l * 0.25, gondolaDrop * 0.65, r * 0.63]} />
        <meshStandardMaterial color="#eee9d8" flatShading />
      </mesh>
      {[-1, 1].flatMap((side) =>
        [-1, 0, 1].map((i) => (
          <mesh
            key={`${side}/${i}`}
            position={[
              l * (0.02 + i * 0.07),
              -r - gondolaDrop * 0.51,
              side * (r * 0.32 + 0.005),
            ]}
          >
            <boxGeometry args={[l * 0.047, gondolaDrop * 0.22, 0.018]} />
            <meshStandardMaterial color="#92b0a6" roughness={0.45} />
          </mesh>
        )),
      )}
      <Label persistent center position={[0, r + 0.6, 0]} zIndexRange={[18, 0]}>
        <a
          className="brand-accessible-link airship-site-link"
          href={ALCHEMIST_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Visit Alchemist"
        >
          <img
            className="airship-mark"
            src="/brands/alchemist-mark.svg"
            alt=""
          />
          <img
            className="airship-wordmark"
            src="/brands/alchemist.svg"
            alt=""
          />
          <span>Alchemist ↗</span>
        </a>
      </Label>
    </group>
  );
}

export function T1ABackdrop({ water }: { water: LakeLayout["water"] }) {
  const [logo] = useBrandTextures(["/brands/t1a.svg"]);
  const { point, width, height, logoWidth, centerY } = t1aBackdrop(water);
  return (
    <group
      name="t1a-backdrop"
      position={point}
      onClick={(event) => {
        event.stopPropagation();
        openBrand(T1A_URL);
      }}
      {...pointer}
    >
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.66, 0.82, 0.28, 8]} />
        <meshStandardMaterial color="#c5c5ad" flatShading />
      </mesh>
      <mesh position={[0, centerY / 2, 0]}>
        <cylinderGeometry args={[0.11, 0.16, centerY, 8]} />
        <meshStandardMaterial color="#6c7a64" flatShading />
      </mesh>
      {/* A raised, camera-facing sign remains readable in the portrait overview. */}
      <Billboard position={[0, centerY, 0]} follow lockX lockZ>
        <mesh>
          <boxGeometry args={[width, height, 0.16]} />
          <meshStandardMaterial color="#314d40" roughness={0.9} />
        </mesh>
        <group position={[0, 0, 0.09]}>
          <LogoPrint
            texture={logo}
            width={logoWidth}
            height={(logoWidth * 350) / 911}
          />
        </group>
      </Billboard>
      <Label
        persistent
        center
        position={[0, centerY + height / 2 + 0.4, 0]}
        zIndexRange={[18, 0]}
      >
        <a
          className="brand-accessible-link"
          href={T1A_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Visit T1A"
        >
          T1A ↗
        </a>
      </Label>
    </group>
  );
}
