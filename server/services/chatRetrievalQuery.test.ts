import { describe, expect, it } from "vitest";

import { chatRetrievalQuery, isSocialMessage } from "./chatRetrievalQuery";

describe("isSocialMessage", () => {
  it.each(["thanks!", "Thank you", "cheers, legend", "ok", "got it 👍", "👍", "🙏🙏"])("is social: %s", (message) => {
    expect(isSocialMessage(message)).toBe(true);
  });

  it.each(["thanks! what about tomorrow?", "ok so how do I pace the sled?", "great session today, legs are sore"])(
    "carries a question or news: %s",
    (message) => {
      expect(isSocialMessage(message)).toBe(false);
    },
  );
});

describe("chatRetrievalQuery", () => {
  const history = [
    { role: "user" as const, content: "How should I pace the run legs of a Hyrox?" },
    { role: "assistant" as const, content: "Start the first km slower than you think." },
  ];

  it("retrieves nothing for thanks", () => {
    expect(chatRetrievalQuery("thanks!", history)).toBeNull();
  });

  it("searches with the previous question for a short follow-up", () => {
    expect(chatRetrievalQuery("what about for the sled?", history)).toBe(
      "How should I pace the run legs of a Hyrox?\nwhat about for the sled?",
    );
  });

  it("searches with the previous question when the message opens with a pronoun", () => {
    expect(chatRetrievalQuery("that seems slow for someone who runs a 22 minute 5k, are you sure?", history)).toContain(
      "How should I pace the run legs of a Hyrox?",
    );
  });

  it("searches with the message alone when it stands on its own", () => {
    const message = "How many wall balls should I do in a training session?";
    expect(chatRetrievalQuery(message, history)).toBe(message);
  });

  it("searches with the message alone when there is no earlier question", () => {
    expect(chatRetrievalQuery("what about the sled?", [])).toBe("what about the sled?");
  });
});
