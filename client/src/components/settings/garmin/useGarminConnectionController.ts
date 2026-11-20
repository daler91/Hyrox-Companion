import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";

import { useGarminMutations } from "@/hooks/useGarminMutations";
import type { GarminStatus } from "@/lib/api";

export function useGarminConnectionController(garminStatus: GarminStatus | undefined) {
  const { connectGarminMutation, disconnectGarminMutation, syncGarminMutation } =
    useGarminMutations();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isConnected = garminStatus?.connected === true;
  const hasError = isConnected && Boolean(garminStatus?.lastError);

  // While Garmin calls are paused after a rate limit, a sync is refused with
  // 503, so Sync is disabled until the pause ends (tech debt #55). A timer
  // marks the pause over at its end, so Sync comes back without a refetch.
  const pausedUntil = isConnected ? (garminStatus?.syncPausedUntil ?? null) : null;
  const [endedPause, setEndedPause] = useState<string | null>(null);
  useEffect(() => {
    if (!pausedUntil) return;
    const timer = setTimeout(
      () => setEndedPause(pausedUntil),
      Math.max(0, new Date(pausedUntil).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pausedUntil]);
  const syncPausedText =
    pausedUntil && pausedUntil !== endedPause
      ? `Garmin paused syncing after a rate limit. Try again after ${format(new Date(pausedUntil), "p")}.`
      : null;

  let statusText = "Import activities from Garmin Connect";
  if (isConnected) {
    if (garminStatus?.lastSyncedAt) {
      statusText = `Last synced ${formatDistanceToNow(new Date(garminStatus.lastSyncedAt), { addSuffix: true })}`;
    } else {
      statusText = "Not yet synced";
    }
  }

  const handleConnect = () => {
    if (!email || !password) return;
    connectGarminMutation.mutate(
      { email, password },
      {
        onSuccess: () => {
          setEmail("");
          setPassword("");
        },
      },
    );
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    isConnected,
    hasError,
    statusText,
    syncPausedText,
    handleConnect,
    connectGarminMutation,
    disconnectGarminMutation,
    syncGarminMutation,
  };
}
