import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";

export function useSaveMessageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (msg: { role: string; content: string }) =>
      api.chat.saveMessage(msg),
    onSuccess: () => {
      // Invalidate the chat-history query so the next surface that
      // mounts useChatSession (e.g. the in-dialog chat after the
      // user backs out + reopens, or the global coach panel after
      // the dialog closes) re-hydrates with the persisted turns.
      // Without this, each useChatSession instance's one-shot
      // history seed would miss messages that only lived in the
      // previous instance's local state.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatHistory }).catch(() => {});
    },
  });
}

export function useClearHistoryMutation(onSuccessCallback?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.chat.clearHistory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatHistory }).catch(() => {});
      if (onSuccessCallback) {
        onSuccessCallback();
      }
    },
  });
}
