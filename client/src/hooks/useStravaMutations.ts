import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useStravaMutations() {
  const { toast } = useToast();

  const connectStravaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/v1/strava/auth");
      return response.json();
    },
    onSuccess: (data: { authUrl: string }) => {
      globalThis.location.href = data.authUrl;
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to initiate Strava connection.",
        variant: "destructive",
      });
    },
  });

  const disconnectStravaMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/v1/strava/disconnect");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/strava/status"] });
      toast({
        title: "Strava Disconnected",
        description: "Your Strava account has been disconnected.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to disconnect Strava.",
        variant: "destructive",
      });
    },
  });

  const syncStravaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/v1/strava/sync");
      return response.json();
    },
    onSuccess: (data: { imported: number; skipped: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/workouts"] });
      toast({
        title: "Sync Complete",
        description: `Imported ${data.imported} new activities. ${data.skipped} already existed.`,
      });
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Failed to sync activities from Strava.",
        variant: "destructive",
      });
    },
  });

  return {
    connectStravaMutation,
    disconnectStravaMutation,
    syncStravaMutation,
  };
}
