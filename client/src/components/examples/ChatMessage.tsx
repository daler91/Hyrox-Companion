import { ChatMessage } from "../ChatMessage";

export default function ChatMessageExample() {
  return (
    <div className="space-y-4 p-4 max-w-2xl">
      <ChatMessage
        role="user"
        content="How has my running improved this month?"
        timestamp="10:30 AM"
      />
      <ChatMessage
        role="assistant"
        content="Based on your training data, your running pace has improved by 8% this month. Your average 1km split went from 4:45 to 4:22. Great progress! Your SkiErg times have also shown consistent improvement."
        timestamp="10:30 AM"
      />
      <ChatMessage
        role="user"
        content="What should I focus on next week?"
        timestamp="10:31 AM"
      />
    </div>
  );
}
