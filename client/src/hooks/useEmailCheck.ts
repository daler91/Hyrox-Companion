import { useEffect, useRef } from "react";

import { email } from "@/lib/api/user";

/** Fire-and-forget email check once per authenticated session. */
export function useEmailCheck(isAuthenticated: boolean, isAppUserLoaded: boolean) {
  const hasFired = useRef(false);
  useEffect(() => {
    if (isAuthenticated && isAppUserLoaded && !hasFired.current) {
      hasFired.current = true;
      email.check().catch(() => {});
    }
  }, [isAuthenticated, isAppUserLoaded]);
}
