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
export function Label(props: ComponentProps<typeof Html>) {
  return <Html {...props} portal={useContext(LabelPortal)} />;
}
