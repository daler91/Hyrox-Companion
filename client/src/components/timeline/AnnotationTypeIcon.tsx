import type { TimelineAnnotationType } from "@shared/schema";
import { Heart, Plane, Stethoscope } from "lucide-react";

interface AnnotationTypeIconProps {
  readonly type: TimelineAnnotationType;
  readonly className?: string;
}

/**
 * Module-level icon picker for annotation types. Declared as its own
 * component (rather than a factory that returns a component reference) so
 * `react-hooks/static-components` does not flag consumers for "creating a
 * component during render".
 */
export function AnnotationTypeIcon({ type, className }: Readonly<AnnotationTypeIconProps>) {
  if (type === "injury") {
    return <Heart className={className} aria-hidden="true" />;
  }
  if (type === "illness") {
    return <Stethoscope className={className} aria-hidden="true" />;
  }
  if (type === "travel") {
    return <Plane className={className} aria-hidden="true" />;
  }
  // rest → reuse Heart until a dedicated icon is chosen.
  return <Heart className={className} aria-hidden="true" />;
}
