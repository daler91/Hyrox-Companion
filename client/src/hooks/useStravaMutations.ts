import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { api, QUERY_KEYS } from "@/lib/api";

export function useStravaMutations() {
  const { toast } = useToast();

  const connectStravaMutation = useMutation({
    mutationFn: () => api.strava.auth(),
    onSuccess: (data) => {
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
    mutationFn: () => api.strava.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stravaStatus });
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
    mutationFn: () => api.strava.sync(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stravaStatus });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts });
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
