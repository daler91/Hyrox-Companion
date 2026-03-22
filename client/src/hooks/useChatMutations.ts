import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, QUERY_KEYS } from "@/lib/api";

export function useSaveMessageMutation() {
  return useMutation({
    mutationFn: (msg: { role: string; content: string }) =>
      api.chat.saveMessage(msg),
  });
}

export function useClearHistoryMutation(onSuccessCallback?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.chat.clearHistory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatHistory });
      if (onSuccessCallback) {
        onSuccessCallback();
      }
    },
  });
}
