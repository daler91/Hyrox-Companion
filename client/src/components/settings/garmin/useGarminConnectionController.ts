import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { useGarminMutations } from "@/hooks/useGarminMutations";
import type { GarminStatus } from "@/lib/api";

export function useGarminConnectionController(garminStatus: GarminStatus | undefined) {
  const { connectGarminMutation, disconnectGarminMutation, syncGarminMutation } =
    useGarminMutations();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isConnected = garminStatus?.connected === true;
  const hasError = isConnected && Boolean(garminStatus?.lastError);

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
    handleConnect,
    connectGarminMutation,
    disconnectGarminMutation,
    syncGarminMutation,
  };
}
