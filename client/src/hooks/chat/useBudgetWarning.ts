import { useCallback, useRef } from "react";

import { useToast } from "@/hooks/use-toast";

/**
 * aiBudgetCheck sets X-AI-Budget-Warning once the athlete has spent most of
 * their rolling 24-hour AI allowance. Returns a check for a chat response that
 * says so once per session, before the limit stops the chat.
 */
export function useBudgetWarning(): (response: Response) => void {
  const { toast } = useToast();
  const warnedRef = useRef(false);

  return useCallback(
    (response: Response) => {
      if (warnedRef.current || response.headers.get("X-AI-Budget-Warning") !== "true") return;
      warnedRef.current = true;
      toast({
        title: "Nearly at today's AI limit",
        description: "Your AI allowance resets on a rolling 24-hour basis.",
      });
    },
    [toast],
  );
}
