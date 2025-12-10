import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Activity, TrendingUp, Target, Calendar, Flame } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { TrainingPlan, TimelineEntry } from "@shared/schema";

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

export default function Coach() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hey! I'm your AI training coach. I can analyze your training data, suggest improvements, help with pacing strategies, and answer any Hyrox-related questions. What would you like to work on today?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: plans = [] } = useQuery<TrainingPlan[]>({
    queryKey: ["/api/plans"],
  });

  const activePlanId = plans.length > 0 ? plans[0]?.id : undefined;

  const { data: timeline = [] } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/timeline", activePlanId],
    queryFn: async () => {
      if (!activePlanId) return [];
      const res = await fetch(`/api/timeline?planId=${activePlanId}`);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
    enabled: !!activePlanId,
  });

  const stats = useMemo(() => calculateStats(timeline), [timeline]);

  const quickSuggestions = [
    "Analyze my training this week",
    "How should I pace my next Hyrox?",
    "What should I focus on next?",
    "Tips for improving sled push",
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

    try {
      const history = messages
        .filter((m) => m.id !== "1")
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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            AI Coach
          </h1>
          <p className="text-sm text-muted-foreground">
            Your personal Hyrox training assistant
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="stats-bar">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-lg font-semibold font-mono" data-testid="stat-workouts-week">
                {stats.workoutsThisWeek}
              </p>
              <p className="text-xs text-muted-foreground">This Week</p>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-green-500/10">
              <Target className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-lg font-semibold font-mono" data-testid="stat-completed">
                {stats.completedThisWeek}
              </p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-blue-500/10">
              <Calendar className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-lg font-semibold font-mono" data-testid="stat-upcoming">
                {stats.plannedUpcoming}
              </p>
              <p className="text-xs text-muted-foreground">Upcoming</p>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-orange-500/10">
              <TrendingUp className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <p className="text-lg font-semibold font-mono" data-testid="stat-rate">
                {stats.completionRate}%
              </p>
              <p className="text-xs text-muted-foreground">Rate</p>
            </div>
          </div>
        </Card>

        <Card className="p-3 col-span-2 md:col-span-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-red-500/10">
              <Flame className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="text-lg font-semibold font-mono" data-testid="stat-streak">
                {stats.currentStreak}
              </p>
              <p className="text-xs text-muted-foreground">Day Streak</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4 max-w-3xl mx-auto">
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
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="flex-shrink-0 p-4 border-t space-y-3 max-w-3xl mx-auto w-full">
          <QuickActions suggestions={quickSuggestions} onSelect={handleQuickAction} />
          <ChatInput onSend={handleSend} isLoading={isLoading} />
        </div>
      </Card>
    </div>
  );
}
