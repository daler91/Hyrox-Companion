import type { SVGProps } from "react";

/** Garmin logo SVG — replaces react-icons/si SiGarmin to eliminate the heavy dependency. */
export function GarminIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="1em"
      height="1em"
      {...props}
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 1.846c5.595 0 10.154 4.559 10.154 10.154S17.595 22.154 12 22.154 1.846 17.595 1.846 12 6.405 1.846 12 1.846zm0 1.23A8.924 8.924 0 003.077 12 8.924 8.924 0 0012 20.923 8.924 8.924 0 0020.923 12 8.924 8.924 0 0012 3.077zm4.615 4.308v1.23H13.23V12h3.385v4.615H12A4.615 4.615 0 017.385 12 4.615 4.615 0 0112 7.385z" />
    </svg>
  );
}
