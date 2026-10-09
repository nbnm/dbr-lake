import { createContext } from "react";
import type { RefObject } from "react";
import type { Vector3 } from "three";

// Job vessels and ambient swimmers share clearance positions for the same frame.
export const SceneTraffic = createContext<RefObject<
  Map<string, Vector3>
> | null>(null);
