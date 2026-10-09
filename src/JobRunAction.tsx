import { ExternalLink } from "lucide-react";
import type { Attempt } from "./types";
import { jobRunLink } from "./runLinks";

export function JobRunAction({
  attempt,
  mode,
  at,
  destinationId,
  captureId,
}: {
  attempt: Attempt;
  mode: string;
  at: number;
  destinationId?: string;
  captureId?: string;
}) {
  const link = jobRunLink(attempt, mode, at, destinationId, captureId);
  return link ? (
    <a
      className="secondary-button"
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {link.label}
      <ExternalLink size={14} />
    </a>
  ) : (
    <small className="evidence-note">
      Run URL unavailable in source metadata.
    </small>
  );
}
