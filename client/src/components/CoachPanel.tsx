import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Activity, TrendingUp, Target, Calendar, Flame, Trash2, Loader2, X, MessageSquare, Check, XIcon, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { calculateStats, type TrainingStats } from "@/lib/statsUtils";
import { useChatSession, type Message } from "@/hooks/useChatSession";
import { getCurrentTimeString } from "@/lib/dateUtils";
import type { TimelineEntry } from "@shared/schema";

interface Suggestion {
  workoutId: string;
  date: string;
  focus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

interface CoachPanelProps {
  isOpen: boolean;
  onClose: () => void;
  timeline?: TimelineEntry[];
  isNewUser?: boolean;
}

export function CoachPanel({ isOpen, onClose, timeline = [], isNewUser = false }: CoachPanelProps) {
  const [pendingSuggestions, setPendingSuggestions] = useState<Suggestion[]>([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);
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
  } = useChatSession({ 
    useStreaming: true,
  });

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

  const saveMessageMutation = useMutation({
    mutationFn: async (msg: { role: string; content: string }) => {
      const res = await apiRequest("POST", "/api/chat/message", msg);
      return res.json();
    },
  });

  const suggestionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timeline/ai-suggestions", {});
      return res.json();
    },
    onSuccess: (data: { suggestions: Suggestion[] }) => {
      let responseContent: string;
      if (!data.suggestions || data.suggestions.length === 0) {
        responseContent = "Your upcoming workouts look well-balanced! I don't have any specific improvements to suggest right now.";
        setPendingSuggestions([]);
      } else {
        responseContent = `I have ${data.suggestions.length} suggestion${data.suggestions.length > 1 ? 's' : ''} for your upcoming workouts. Review them below and click Apply to add them to your plan.`;
        setPendingSuggestions(data.suggestions);
      }
      
      const suggestionsMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: responseContent,
        timestamp: getCurrentTimeString(),
      };
      setLocalMessages(prev => [...prev, suggestionsMessage]);
      saveMessageMutation.mutate({ role: "assistant", content: responseContent });
    },
    onError: () => {
      const errorContent = "Sorry, I couldn't analyze your workouts right now. Please try again.";
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: errorContent,
        timestamp: getCurrentTimeString(),
      };
      setLocalMessages(prev => [...prev, errorMessage]);
    },
  });

  const handleApplySuggestion = async (suggestion: Suggestion) => {
    setApplyingId(suggestion.workoutId);
    try {
      const workoutEntry = timeline.find(e => e.planDayId === suggestion.workoutId);
      if (!workoutEntry) {
        const errorMessage: Message = {
          id: Date.now().toString(),
          role: "assistant",
          content: `Could not find the workout for ${suggestion.focus} (${suggestion.date}). The suggestion is still available to retry.`,
          timestamp: getCurrentTimeString(),
        };
        setLocalMessages(prev => [...prev, errorMessage]);
        return;
      }

      const currentValue = (workoutEntry[suggestion.targetField] as string) || "";
      let newValue: string;
      
      if (suggestion.action === "append") {
        if (currentValue.trim()) {
          newValue = `${currentValue}\n\nAI suggestion: ${suggestion.recommendation}`;
        } else {
          newValue = `AI suggestion: ${suggestion.recommendation}`;
        }
      } else {
        newValue = suggestion.recommendation;
      }

      await apiRequest("PATCH", `/api/plans/days/${suggestion.workoutId}`, {
        [suggestion.targetField]: newValue,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      if (suggestion.action === "replace" && suggestion.targetField === "mainWorkout") {
        queryClient.invalidateQueries({ queryKey: ["/api/exercise-analytics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/personal-records"] });
      }
      setPendingSuggestions(prev => prev.filter(s => s.workoutId !== suggestion.workoutId));
      
      const confirmMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `Applied suggestion to ${suggestion.focus} (${suggestion.date}). The ${suggestion.targetField === "mainWorkout" ? "main workout" : suggestion.targetField} has been updated.`,
        timestamp: getCurrentTimeString(),
      };
      setLocalMessages(prev => [...prev, confirmMessage]);
    } catch (error) {
      console.error("Apply suggestion error:", error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `Failed to apply suggestion to ${suggestion.focus}. Please try again.`,
        timestamp: getCurrentTimeString(),
      };
      setLocalMessages(prev => [...prev, errorMessage]);
    } finally {
      setApplyingId(null);
    }
  };

  const handleDismissSuggestion = (workoutId: string) => {
    setPendingSuggestions(prev => prev.filter(s => s.workoutId !== workoutId));
  };

  const quickActions = [
    { id: "suggestions", label: "Get workout suggestions" },
    { id: "analyze", label: "Analyze my training" },
    { id: "pacing", label: "Pacing tips" },
    { id: "sled", label: "Sled push help" },
  ];

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        scrollToBottom();
      }, 50);
    }
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    if (isOpen && isNewUser && !hasShownWelcome && messages.length === 0) {
      setHasShownWelcome(true);
      const welcomeMessage: Message = {
        id: "new-user-welcome",
        role: "assistant",
        content: "Welcome to HyroxTracker! I'm your AI training coach, here to help you prepare for Hyrox.\n\nTo get started, you can:\n- **Use our 8-week training plan** - a structured program covering running, strength, and all Hyrox stations\n- **Import your own plan** - if you have a CSV training plan\n- **Log individual workouts** - track sessions as you complete them\n\nOnce you have some training data, I can analyze your progress, suggest improvements, and help with pacing strategies. What would you like to know about Hyrox training?",
        timestamp: getCurrentTimeString(),
      };
      setLocalMessages([welcomeMessage]);
    }
  }, [isOpen, isNewUser, hasShownWelcome, messages.length]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async (content: string) => {
    await sendMessage(content);
  };

  const handleQuickAction = (action: { id: string; label: string }) => {
    if (action.id === "suggestions") {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: action.label,
        timestamp: getCurrentTimeString(),
      };
      setLocalMessages(prev => [...prev, userMessage]);
      saveMessageMutation.mutate({ role: "user", content: action.label });
      suggestionsMutation.mutate();
    } else {
      handleSend(action.label);
    }
  };

  const handleClearHistory = () => {
    clearHistory();
    setLocalMessages([]);
    setPendingSuggestions([]);
  };

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
          {pendingSuggestions.length > 0 && (
            <div className="space-y-2">
              {pendingSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.workoutId}
                  suggestion={suggestion}
                  onApply={() => handleApplySuggestion(suggestion)}
                  onDismiss={() => handleDismissSuggestion(suggestion.workoutId)}
                  isApplying={applyingId === suggestion.workoutId}
                />
              ))}
            </div>
          )}
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
        <QuickActions actions={quickActions} onSelect={handleQuickAction} disabled={isProcessing} />
        <ChatInput onSend={handleSend} isLoading={isProcessing} />
      </div>
    </div>
  );
}

interface StatBadgeProps {
  icon: React.ElementType;
  value: number | string;
  label: string;
  color: string;
}

function StatBadge({ icon: Icon, value, label, color }: StatBadgeProps) {
  return (
    <div className="flex flex-col items-center p-1 rounded-md bg-muted/50">
      <Icon className={`h-3 w-3 ${color}`} />
      <span className="text-sm font-semibold font-mono">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  onApply: () => void;
  onDismiss: () => void;
  isApplying: boolean;
}

function SuggestionCard({ suggestion, onApply, onDismiss, isApplying }: SuggestionCardProps) {
  const fieldLabel = suggestion.targetField === "mainWorkout" 
    ? "Main Workout" 
    : suggestion.targetField === "accessory" 
      ? "Accessory" 
      : "Notes";
  
  const actionLabel = suggestion.action === "append" ? "Add to" : "Replace";
  
  const priorityColor = suggestion.priority === "high" 
    ? "bg-red-500/10 text-red-600 dark:text-red-400" 
    : suggestion.priority === "medium" 
      ? "bg-orange-500/10 text-orange-600 dark:text-orange-400" 
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400";

  return (
    <Card className="p-3 space-y-2" data-testid={`suggestion-card-${suggestion.workoutId}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{suggestion.focus}</span>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {suggestion.date}
            </Badge>
            <Badge className={`text-[10px] shrink-0 ${priorityColor}`}>
              {suggestion.priority}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Zap className="h-3 w-3 text-primary shrink-0" />
            <span className="text-xs text-muted-foreground">
              {actionLabel} {fieldLabel}
            </span>
          </div>
        </div>
      </div>
      
      <p className="text-sm">{suggestion.recommendation}</p>
      <p className="text-xs text-muted-foreground italic">{suggestion.rationale}</p>
      
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={onApply}
          disabled={isApplying}
          data-testid={`button-apply-${suggestion.workoutId}`}
        >
          {isApplying ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={isApplying}
          data-testid={`button-dismiss-${suggestion.workoutId}`}
        >
          <XIcon className="h-3 w-3 mr-1" />
          Dismiss
        </Button>
      </div>
    </Card>
  );
}
