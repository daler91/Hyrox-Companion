import { useCallback, useEffect, useRef } from "react";

const STICKY_SCROLL_THRESHOLD_PX = 48;

/**
 * Keeps a chat viewport pinned to the newest message while the athlete is at
 * the bottom, and leaves it alone once they scroll up to read. `messages` is
 * only a change signal: every new message (or streamed chunk) re-pins.
 */
export function useChatAutoScroll(messages: readonly unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const updateAutoScrollMode = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    shouldAutoScrollRef.current = distanceFromBottom <= STICKY_SCROLL_THRESHOLD_PX;
  }, []);

  const scrollToBottomIfPinned = useCallback(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  const pinAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true;
  }, []);

  useEffect(() => {
    scrollToBottomIfPinned();
  }, [messages, scrollToBottomIfPinned]);

  return { scrollRef, scrollToBottom, updateAutoScrollMode, scrollToBottomIfPinned, pinAutoScroll };
}
