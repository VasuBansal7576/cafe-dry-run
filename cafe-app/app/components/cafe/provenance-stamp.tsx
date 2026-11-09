import type { SourceTag } from "../../../server/lib/cafe/provenance";
import { sourceLabels } from "./scenario-inputs";

export function Stamp({
  tag,
  stale = false,
}: {
  tag?: SourceTag | undefined;
  stale?: boolean;
}) {
  if (!tag && !stale) return null;
  return (
    <span className="cafe-stamp">
      {tag && sourceLabels[tag]}
      {tag && stale && " · "}
      {stale && "Stale"}
    </span>
  );
}
