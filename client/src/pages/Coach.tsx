import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Activity, TrendingUp, Target, Calendar, Flame, Trash2, Loader2 } from "lucide-react";
import type { TrainingPlan, TimelineEntry } from "@shared/schema";
import { calculateStats, type TrainingStats } from "@/lib/statsUtils";
import { useChatSession, type Message } from "@/hooks/useChatSession";

const COACH_WELCOME_MESSAGE = "Hey! I'm your AI training coach. I can analyze your training data, suggest improvements, help with pacing strategies, and answer any Hyrox-related questions. What would you like to work on today?";

export default function Coach() {
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

  const trainingContext = timeline.length > 0 
    ? `\n\nCurrent training context: ${stats.completedThisWeek} workouts completed this week, ${stats.plannedUpcoming} planned upcoming, ${stats.completionRate}% completion rate, ${stats.currentStreak} day streak.`
    : "";

  const {
    messages,
    isLoading,
    scrollRef,
    sendMessage,
    clearHistory,
    isClearingHistory,
    hasMessages,
  } = useChatSession({
    welcomeMessage: COACH_WELCOME_MESSAGE,
    trainingContext,
  });

  const quickActions = [
    { id: "analyze", label: "Analyze my training this week" },
    { id: "pacing", label: "How should I pace my next Hyrox?" },
    { id: "focus", label: "What should I focus on next?" },
    { id: "sled", label: "Tips for improving sled push" },
  ];

  const handleQuickAction = (action: { id: string; label: string }) => {
    sendMessage(action.label);
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
        {hasMessages && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearHistory}
            disabled={isClearingHistory}
            data-testid="button-clear-chat"
          >
            {isClearingHistory ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {isClearingHistory ? "Clearing..." : "Clear History"}
          </Button>
        )}
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
          <QuickActions actions={quickActions} onSelect={handleQuickAction} />
          <ChatInput onSend={sendMessage} isLoading={isLoading} />
        </div>
      </Card>
    </div>
  );
}
