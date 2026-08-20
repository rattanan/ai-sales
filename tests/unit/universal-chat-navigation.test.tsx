// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniversalChat } from "@/components/chat/universal-chat";
import { submitMessageFeedbackAction } from "@/features/chat/actions";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/features/chat/actions", () => ({
  submitMessageFeedbackAction: vi.fn(),
}));

const existingMessage = {
  id: "message-1",
  role: "ASSISTANT" as const,
  content: "Existing conversation answer",
  citations: [],
};

function renderChat() {
  return render(
    <UniversalChat
      bots={[]}
      sources={[]}
      conversations={[
        {
          id: "conversation-1",
          title: "Existing conversation",
          botName: "InsightKM Assistant",
          lastMessageAt: "2026-08-19T01:00:00.000Z",
        },
      ]}
      selectedConversationId="conversation-1"
      initialMessages={[existingMessage]}
      historyQuery=""
    />,
  );
}

describe("universal chat navigation", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.mocked(submitMessageFeedbackAction).mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears the active conversation when New chat is selected", () => {
    renderChat();

    fireEvent.click(screen.getByRole("link", { name: /new chat/i }));

    expect(screen.queryByText(existingMessage.content)).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Ask across governed knowledge" }),
    ).toBeTruthy();
  });

  it("shows the saved state after helpful feedback is submitted", async () => {
    vi.mocked(submitMessageFeedbackAction).mockResolvedValue({
      ok: true,
      rating: 1,
    });
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Helpful answer" }));

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Helpful answer" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Saved as helpful"),
    );
  });

  it("updates the URL after the first message creates a conversation", async () => {
    const result = {
      conversation: { id: "conversation/new id" },
      userMessage: { id: "message-user", content: "Hello" },
      assistantMessage: {
        id: "message-assistant",
        role: "ASSISTANT",
        content: "Hi",
        citations: [],
      },
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        [
          `event: token\ndata: ${JSON.stringify("H")}\n\n`,
          `event: token\ndata: ${JSON.stringify("i")}\n\n`,
          `event: result\ndata: ${JSON.stringify(result)}\n\n`,
        ].join(""),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    render(
      <UniversalChat
        bots={[]}
        sources={[]}
        conversations={[]}
        initialMessages={[]}
        historyQuery=""
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Ask InsightKM…"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/workspace/chat?conversation=conversation%2Fnew%20id",
        { scroll: false },
      ),
    );
  });
});
