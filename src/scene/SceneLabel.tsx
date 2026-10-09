import {
  createContext,
  useContext,
  type ComponentProps,
  type RefObject,
} from "react";
import { Html } from "@react-three/drei";

export const LabelPortal = createContext<RefObject<HTMLDivElement> | undefined>(
  undefined,
);
export const SceneCaptions = createContext(false);
export function Label({
  persistent = false,
  ...props
}: ComponentProps<typeof Html> & { persistent?: boolean }) {
  const portal = useContext(LabelPortal);
  const captions = useContext(SceneCaptions);
  return captions || persistent ? <Html {...props} portal={portal} /> : null;
}
