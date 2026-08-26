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

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/features/chat/actions", () => ({
  deleteConversationAction: vi.fn(),
  submitMessageFeedbackAction: vi.fn(),
}));

/**
 * jsdom reports every element as zero-sized, so the scroll geometry has to be
 * installed by hand. These stand in for a transcript taller than its box.
 */
function makeScrollable(log: HTMLElement, scrollTop: number) {
  Object.defineProperty(log, "scrollHeight", { value: 2_000, writable: true });
  Object.defineProperty(log, "clientHeight", { value: 500, writable: true });
  log.scrollTop = scrollTop;
}

function renderChat(messageCount: number) {
  return render(
    <UniversalChat
      bots={[]}
      sources={[]}
      conversations={[]}
      selectedConversationId="conversation-1"
      initialMessages={Array.from({ length: messageCount }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? ("USER" as const) : ("ASSISTANT" as const),
        content: `Message ${index}`,
        citations: [],
      }))}
      historyQuery=""
    />,
  );
}

function stubTurn() {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      `event: result\ndata: ${JSON.stringify({
        conversation: { id: "conversation-1" },
        userMessage: { id: "message-user", content: "Another question" },
        assistantMessage: {
          id: "message-assistant",
          role: "ASSISTANT",
          content: "Another answer",
          citations: [],
        },
      })}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ),
  );
}

async function sendSomething() {
  fireEvent.change(screen.getByPlaceholderText("Ask AI-Sales…"), {
    target: { value: "Another question" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText("Another answer")).toBeTruthy());
}

describe("chat transcript scrolling", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the transcript in its own scroll container", () => {
    renderChat(4);

    const log = screen.getByRole("log");
    // The composer stays put because this box scrolls, not the page.
    expect(log.className).toContain("overflow-y-auto");
    expect(log.className).toContain("min-h-0");
    expect(log.className).toContain("flex-1");
  });

  it("follows the bottom when a new turn arrives", async () => {
    stubTurn();
    renderChat(2);
    const log = screen.getByRole("log");
    makeScrollable(log, 1_500);
    fireEvent.scroll(log);

    await sendSomething();

    expect(log.scrollTop).toBe(2_000);
  });

  it("leaves a reader alone once they scroll up to re-read", async () => {
    stubTurn();
    renderChat(2);
    const log = screen.getByRole("log");
    makeScrollable(log, 200);
    fireEvent.scroll(log);

    await sendSomething();

    // Scrolled 1,300px away from the bottom: a new answer must not yank the
    // view back while they are reading something earlier.
    expect(log.scrollTop).toBe(200);
  });
});
