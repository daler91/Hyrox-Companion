import { useState, useEffect, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { StatBadge } from "@/components/coach/StatBadge";
import { SuggestionsList, useSuggestions } from "@/components/coach/SuggestionsTab";
import { Activity, TrendingUp, Target, Calendar, Flame, Trash2, Loader2, X, MessageSquare } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { calculateStats } from "@/lib/statsUtils";
import { useChatSession, type Message } from "@/hooks/useChatSession";
import { useSaveMessageMutation } from "@/hooks/useChatMutations";
import { getCurrentTimeString } from "@/lib/dateUtils";
import type { TimelineEntry } from "@shared/schema";

const WELCOME_TEXT = "Welcome to HyroxTracker! I'm your AI training coach, here to help you prepare for Hyrox.\n\nTo get started, you can:\n- **Use our 8-week training plan** - a structured program covering running, strength, and all Hyrox stations\n- **Import your own plan** - if you have a CSV training plan\n- **Log individual workouts** - track sessions as you complete them\n\nOnce you have some training data, I can analyze your progress, suggest improvements, and help with pacing strategies. What would you like to know about Hyrox training?";

const QUICK_ACTIONS = [
  { id: "suggestions", label: "Get workout suggestions" },
  { id: "analyze", label: "Analyze my training" },
  { id: "pacing", label: "Pacing tips" },
  { id: "sled", label: "Sled push help" },
];

interface CoachPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly timeline?: TimelineEntry[];
  readonly isNewUser?: boolean;
}

export function CoachPanel(props: Readonly<CoachPanelProps>) {
  const { isOpen, onClose, timeline = [], isNewUser = false } = props;
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
    const allMessages = [...hookMessages];
    for (const localMsg of localMessages) {
      if (!allMessages.find(m => m.id === localMsg.id)) {
        allMessages.push(localMsg);
      }
    }
    allMessages.sort((a, b) => {
      if (a.id === "welcome") return -1;
      if (b.id === "welcome") return 1;
      return Number(a.id) - Number(b.id);
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
      sendMessage(action.label);
    }
  };

  const handleClearHistory = () => { clearHistory(); setLocalMessages([]); clearSuggestions(); };

  const isProcessing = isLoading || suggestionsMutation.isPending;

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full border-l bg-background">
      <div className="flex items-center justify-between gap-2 p-3 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">AI Coach</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearHistory}
              disabled={isClearingHistory}
              title="Clear chat"
              aria-label="Clear chat history"
              data-testid="button-clear-chat"
            >
              {isClearingHistory ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close coach"
            aria-label="Close coach panel"
            data-testid="button-close-coach"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1.5 p-2 border-b flex-shrink-0" data-testid="stats-bar">
        <StatBadge icon={Activity} value={stats.workoutsThisWeek} label="Week" color="text-primary" />
        <StatBadge icon={Target} value={stats.completedThisWeek} label="Done" color="text-green-500" />
        <StatBadge icon={Calendar} value={stats.plannedUpcoming} label="Next" color="text-blue-500" />
        <StatBadge icon={TrendingUp} value={`${stats.completionRate}%`} label="Rate" color="text-orange-500" />
        <StatBadge icon={Flame} value={stats.currentStreak} label="Streak" color="text-red-500" />
      </div>

      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
            />
          ))}
          <SuggestionsList
            suggestions={pendingSuggestions}
            applyingId={applyingId}
            onApply={handleApplySuggestion}
            onDismiss={handleDismissSuggestion}
          />
          {isProcessing && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-xs">Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>
      
      <div className="flex-shrink-0 p-2 border-t space-y-2">
        <QuickActions actions={QUICK_ACTIONS} onSelect={handleQuickAction} disabled={isProcessing} />
        <ChatInput onSend={sendMessage} isLoading={isProcessing} />
      </div>
    </div>
  );
}
