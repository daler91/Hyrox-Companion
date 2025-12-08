import { ChatInput } from "../ChatInput";

export default function ChatInputExample() {
  return (
    <div className="p-4 max-w-2xl">
      <ChatInput
        onSend={(message) => console.log("Send message:", message)}
        isLoading={false}
      />
    </div>
  );
}
