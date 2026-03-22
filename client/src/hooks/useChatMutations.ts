import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendChatMessage, clearChatHistory } from "@/lib/api";

export function useSaveMessageMutation() {
  return useMutation({
    mutationFn: async (msg: { role: string; content: string }) => {
      return await sendChatMessage(msg);
    },
  });
}

export function useClearHistoryMutation(onSuccessCallback?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return await clearChatHistory();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/chat/history"] });
      if (onSuccessCallback) {
        onSuccessCallback();
      }
    },
  });
}
