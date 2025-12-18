import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Activity, TrendingUp, Target, Calendar, Flame, Trash2, Loader2, X, MessageSquare } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TrainingPlan, TimelineEntry, ChatMessage as DBChatMessage } from "@shared/schema";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface TrainingStats {
  workoutsThisWeek: number;
  completedThisWeek: number;
  plannedUpcoming: number;
  completionRate: number;
  currentStreak: number;
}

function calculateStats(timeline: TimelineEntry[]): TrainingStats {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  const thisWeekEntries = timeline.filter(entry => {
    const entryDate = new Date(entry.date);
    return entryDate >= startOfWeek && entryDate < endOfWeek;
  });

  const completedThisWeek = thisWeekEntries.filter(e => e.status === "completed").length;
  const totalThisWeek = thisWeekEntries.length;
  const plannedUpcoming = timeline.filter(e => {
    const entryDate = new Date(e.date);
    return entryDate >= now && e.status === "planned";
  }).length;

  const completedDates = new Set(
    timeline
      .filter(e => e.status === "completed")
      .map(e => {
        const d = new Date(e.date);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })
  );
  
  const uniqueDays = Array.from(completedDates).sort((a, b) => b - a);
  
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (let i = 0; i < uniqueDays.length; i++) {
    const expectedDate = today.getTime() - (i * 24 * 60 * 60 * 1000);
    if (uniqueDays[i] === expectedDate) {
      streak++;
    } else if (i === 0 && uniqueDays[i] === expectedDate - (24 * 60 * 60 * 1000)) {
      streak++;
    } else {
      break;
    }
  }

  return {
    workoutsThisWeek: totalThisWeek,
    completedThisWeek,
    plannedUpcoming,
    completionRate: totalThisWeek > 0 ? Math.round((completedThisWeek / totalThisWeek) * 100) : 0,
    currentStreak: streak,
  };
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: "Hey! I'm your AI training coach. Ask me about pacing, training tips, or anything Hyrox-related!",
  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
};

interface CoachPanelProps {
  isOpen: boolean;
  onClose: () => void;
  timeline?: TimelineEntry[];
}

export function CoachPanel({ isOpen, onClose, timeline = [] }: CoachPanelProps) {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<DBChatMessage[]>({
    queryKey: ["/api/chat/history"],
    enabled: isOpen,
  });

  useEffect(() => {
    if (!historyLoading && chatHistory.length > 0 && !historyLoaded) {
      const loadedMessages: Message[] = chatHistory.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: msg.timestamp 
          ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "",
      }));
      setMessages([WELCOME_MESSAGE, ...loadedMessages]);
      setHistoryLoaded(true);
    } else if (!historyLoading && chatHistory.length === 0 && !historyLoaded) {
      setHistoryLoaded(true);
    }
  }, [chatHistory, historyLoading, historyLoaded]);

  const saveMessageMutation = useMutation({
    mutationFn: async (msg: { role: string; content: string }) => {
      const res = await apiRequest("POST", "/api/chat/message", msg);
      return res.json();
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/chat/history");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/history"] });
      setMessages([WELCOME_MESSAGE]);
      setHistoryLoaded(false);
    },
  });

  const stats = useMemo(() => calculateStats(timeline), [timeline]);

  const quickSuggestions = [
    "Analyze my training",
    "Pacing tips",
    "Sled push help",
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    saveMessageMutation.mutate({ role: "user", content });

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const trainingContext = timeline.length > 0 
        ? `\n\nCurrent training context: ${stats.completedThisWeek} workouts completed this week, ${stats.plannedUpcoming} planned upcoming, ${stats.completionRate}% completion rate, ${stats.currentStreak} day streak.`
        : "";

      const response = await apiRequest("POST", "/api/chat", { 
        message: content + trainingContext, 
        history 
      });
      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      saveMessageMutation.mutate({ role: "assistant", content: data.response });
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (suggestion: string) => {
    handleSend(suggestion);
  };

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
              onClick={() => clearHistoryMutation.mutate()}
              disabled={clearHistoryMutation.isPending}
              title="Clear chat"
              data-testid="button-clear-chat"
            >
              {clearHistoryMutation.isPending ? (
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
          {isLoading && (
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
        <QuickActions suggestions={quickSuggestions} onSelect={handleQuickAction} />
        <ChatInput onSend={handleSend} isLoading={isLoading} />
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
