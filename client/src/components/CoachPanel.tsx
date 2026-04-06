import type { TimelineEntry } from "@shared/schema";
import { useCallback,useEffect, useMemo, useState } from "react";

import { CoachPanelChatArea } from "@/components/coach/CoachPanelChatArea";
import { CoachPanelFooter } from "@/components/coach/CoachPanelFooter";
import { CoachPanelHeader } from "@/components/coach/CoachPanelHeader";
import { CoachPanelStats } from "@/components/coach/CoachPanelStats";
import { useSuggestions } from "@/components/coach/SuggestionsTab";
import { useSaveMessageMutation } from "@/hooks/useChatMutations";
import { type Message,useChatSession } from "@/hooks/useChatSession";
import { getCurrentTimeString } from "@/lib/dateUtils";
import { calculateStats } from "@/lib/statsUtils";

const WELCOME_TEXT = "Welcome to fitai.coach! I'm your AI training coach, here to help you reach your fitness goals.\n\nTo get started, you can:\n- **Use our 8-week fitness plan** - a structured program covering running, strength, and functional exercises\n- **Import your own plan** - if you have a CSV training plan\n- **Log individual workouts** - track sessions as you complete them\n\nOnce you have some training data, I can analyze your progress, suggest improvements, and help optimize your training. What are you working towards?";

const QUICK_ACTIONS = [
  { id: "suggestions", label: "Get workout suggestions" },
  { id: "analyze", label: "Analyze my training" },
  { id: "pacing", label: "Pacing tips" },
  { id: "form", label: "Exercise form tips" },
];

interface CoachPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly timeline?: TimelineEntry[];
  readonly isNewUser?: boolean;
}

export function CoachPanel({ isOpen, onClose, timeline = [], isNewUser = false }: Readonly<CoachPanelProps>) {
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [hasShownWelcome, setHasShownWelcome] = useState(false);

  const stats = useMemo(() => calculateStats(timeline), [timeline]);

  const {
    messages: hookMessages,
    isLoading,
    scrollRef,
    sendMessage,
    clearHistory,
    isClearingHistory,
    scrollToBottom,
  } = useChatSession({ useStreaming: true });

  const messages = useMemo(() => {
    // ⚡ Perf: Use Set for O(1) ID lookups instead of .some() which is O(N),
    // reducing deduplication from O(N*M) to O(N+M).
    const existingIds = new Set(hookMessages.map(m => m.id));
    const allMessages = [...hookMessages];
    for (const localMsg of localMessages) {
      if (!existingIds.has(localMsg.id)) {
        allMessages.push(localMsg);
        existingIds.add(localMsg.id);
      }
    }
    allMessages.sort((a, b) => {
      if (a.id === "welcome") return -1;
      if (b.id === "welcome") return 1;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
    return allMessages;
  }, [hookMessages, localMessages]);

  const saveMessageMutation = useSaveMessageMutation();

  const addLocalMessage = useCallback((message: Message) => {
    setLocalMessages(prev => [...prev, message]);
  }, []);

  const saveMessage = useCallback((msg: { role: string; content: string }) => {
    saveMessageMutation.mutate(msg);
  }, [saveMessageMutation]);

  const {
    pendingSuggestions,
    applyingId,
    suggestionsRagInfo,
    suggestionsMutation,
    handleApplySuggestion,
    handleDismissSuggestion,
    clearSuggestions,
  } = useSuggestions({ timeline, addLocalMessage, saveMessage });

  useEffect(() => {
    if (isOpen) setTimeout(() => scrollToBottom(), 50);
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    if (isOpen && isNewUser && !hasShownWelcome && messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasShownWelcome(true);
      setLocalMessages([{ id: "new-user-welcome", role: "assistant", content: WELCOME_TEXT, timestamp: getCurrentTimeString() }]);
    }
  }, [isOpen, isNewUser, hasShownWelcome, messages.length]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleQuickAction = (action: { id: string; label: string }) => {
    if (action.id === "suggestions") {
      addLocalMessage({ id: Date.now().toString(), role: "user", content: action.label, timestamp: getCurrentTimeString() });
      saveMessage({ role: "user", content: action.label });
      suggestionsMutation.mutate();
    } else {
      sendMessage(action.label).catch(() => {});
    }
  };

  const handleClearHistory = () => { clearHistory(); setLocalMessages([]); clearSuggestions(); };

  const isProcessing = isLoading || suggestionsMutation.isPending;

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full border-l bg-background">
      <CoachPanelHeader
        onClearHistory={handleClearHistory}
        onClose={onClose}
        isClearingHistory={isClearingHistory}
        canClearHistory={messages.length > 1}
      />
      <CoachPanelStats stats={stats} />
      <CoachPanelChatArea
        ref={scrollRef}
        messages={messages}
        pendingSuggestions={pendingSuggestions}
        applyingId={applyingId}
        suggestionsRagInfo={suggestionsRagInfo}
        isProcessing={isProcessing}
        onApplySuggestion={handleApplySuggestion}
        onDismissSuggestion={handleDismissSuggestion}
      />
      <CoachPanelFooter
        quickActions={QUICK_ACTIONS}
        onQuickAction={handleQuickAction}
        onSendMessage={sendMessage}
        isProcessing={isProcessing}
      />
    </div>
  );
}
