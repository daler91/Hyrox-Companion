import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export function useSaveMessageMutation() {
  return useMutation({
    mutationFn: async (msg: { role: string; content: string }) => {
      const res = await apiRequest("POST", "/api/v1/chat/message", msg);
      return res.json();
    },
  });
}

export function useClearHistoryMutation(onSuccessCallback?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/v1/chat/history");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/chat/history"] });
      if (onSuccessCallback) {
        onSuccessCallback();
      }
    },
  });
}
