import * as React from "react"

const MOBILE_BREAKPOINT = 768

function readIsMobile(): boolean | undefined {
  if (typeof globalThis.innerWidth !== "number") return undefined;
  return globalThis.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  // Lazy initialize so the first render already reflects the current
  // viewport — avoids a setState-inside-useEffect to seed the value,
  // which the `react-hooks/set-state-in-effect` rule (correctly) flags.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(readIsMobile)

  React.useEffect(() => {
    const mql = globalThis.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(globalThis.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
