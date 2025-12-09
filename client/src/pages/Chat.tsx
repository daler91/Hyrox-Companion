import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Activity, TrendingUp, Calendar } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hi! I'm your AI training coach powered by Gemini. I can help you with Hyrox training advice, workout planning, pacing strategies, and answer questions about the competition. What would you like to know?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const quickSuggestions = [
    "How should I pace a Hyrox race?",
    "Best SkiErg technique tips",
    "Weekly training plan",
    "How to improve sled push",
  ];

  const mockStats = {
    workoutsThisWeek: 5,
    avgDuration: 52,
    topExercise: "Running",
    improvement: "+8%",
  };

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

      const response = await apiRequest("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: content, history }),
        headers: { "Content-Type": "application/json" },
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
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)] gap-4 p-4 md:p-8">
      <Card className="hidden lg:flex flex-col w-80 flex-shrink-0">
        <CardHeader>
          <CardTitle className="text-lg">Training Context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Activity className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">{mockStats.workoutsThisWeek} workouts</p>
              <p className="text-xs text-muted-foreground">This week</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Calendar className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">{mockStats.avgDuration} min avg</p>
              <p className="text-xs text-muted-foreground">Session duration</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-sm font-medium">{mockStats.improvement}</p>
              <p className="text-xs text-muted-foreground">Running pace improvement</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="flex-shrink-0 border-b">
          <CardTitle className="text-lg">AI Coach</CardTitle>
        </CardHeader>
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
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
                <div className="animate-pulse">Thinking...</div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="flex-shrink-0 p-4 border-t space-y-3">
          <QuickActions suggestions={quickSuggestions} onSelect={handleQuickAction} />
          <ChatInput onSend={handleSend} isLoading={isLoading} />
        </div>
      </Card>
    </div>
  );
}
