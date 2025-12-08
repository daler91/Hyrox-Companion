import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { QuickActions } from "@/components/QuickActions";
import { Activity, TrendingUp, Calendar } from "lucide-react";

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
      content: "Hi! I'm your AI training coach. I can help you analyze your Hyrox training data, suggest improvements, and answer questions about your performance. What would you like to know?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const quickSuggestions = [
    "Analyze my running pace",
    "Show weekly volume",
    "Compare to last month",
    "Suggest next workout",
  ];

  // todo: remove mock functionality
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

  const generateResponse = (userMessage: string): string => {
    // todo: remove mock functionality - replace with actual AI call
    const lowerMessage = userMessage.toLowerCase();
    
    if (lowerMessage.includes("running") || lowerMessage.includes("pace")) {
      return "Based on your training data, your running pace has improved by 8% this month. Your average 1km split went from 4:45 to 4:22. You've completed 12 running sessions with a total of 48km logged. Keep up the consistency!";
    }
    
    if (lowerMessage.includes("weekly") || lowerMessage.includes("volume")) {
      return `This week you've completed ${mockStats.workoutsThisWeek} workouts with an average duration of ${mockStats.avgDuration} minutes. Your most trained exercise is ${mockStats.topExercise}. You're on track to exceed last week's volume by 15%.`;
    }
    
    if (lowerMessage.includes("compare") || lowerMessage.includes("month")) {
      return "Comparing your current month to last month:\n\n- Total workouts: 18 vs 14 (+29%)\n- Training hours: 15.2 vs 11.8 (+29%)\n- Running distance: 52km vs 38km (+37%)\n- Personal bests: 3 this month\n\nExcellent progress! Your consistency is really paying off.";
    }
    
    if (lowerMessage.includes("suggest") || lowerMessage.includes("next")) {
      return "Based on your recent training patterns, I recommend:\n\n1. **Tomorrow**: Light recovery run (20-30 min) - you've had two intense sessions in a row\n\n2. **In 2 days**: SkiErg + Sled work - these areas haven't been trained in 4 days\n\n3. **Weekend**: Consider a full Hyrox simulation to test your race fitness\n\nWould you like me to create a detailed workout plan?";
    }
    
    if (lowerMessage.includes("skierg")) {
      return "Your SkiErg performance:\n\n- Best 1000m time: 3:52\n- Average pace: 4:15/1000m\n- Total distance this month: 8,500m\n- Sessions: 6\n\nTip: Try adding more 500m intervals to improve your power output. Your endurance is good, but you could benefit from more high-intensity work.";
    }

    return "I can help you analyze your training data, track progress, and suggest improvements. Try asking about specific exercises, your weekly volume, or how to improve in certain areas. What aspect of your training would you like to focus on?";
  };

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Simulate AI response delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: generateResponse(content),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsLoading(false);
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
