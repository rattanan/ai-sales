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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/features/chat/actions", () => ({
  submitMessageFeedbackAction: vi.fn(),
}));

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A turn that thinks twice, calls one tool, then answers. */
function streamedTurn() {
  return new Response(
    [
      sse("step", { kind: "reasoning", step: 0, delta: "ผู้ใช้ถามเรื่อง" }),
      sse("step", { kind: "reasoning", step: 0, delta: "ความเร็ว" }),
      sse("step", {
        kind: "tool_start",
        step: 0,
        toolCallId: "call-a",
        toolName: "search_documents",
        arguments: { query: "ความเร็ว" },
      }),
      sse("step", {
        kind: "tool_end",
        step: 0,
        toolCallId: "call-a",
        toolName: "search_documents",
        isError: false,
        durationMs: 143,
        summary: "พบ 6 ส่วน",
      }),
      sse("step", { kind: "reasoning", step: 1, delta: "พอแล้ว ตอบได้" }),
      sse("token", "มี 4 ระดับ"),
      sse("result", {
        conversation: { id: "conversation-new" },
        userMessage: { id: "message-user", content: "ถาม" },
        assistantMessage: {
          id: "message-assistant",
          role: "ASSISTANT",
          content: "มี 4 ระดับ",
          citations: [],
          toolTimeline: [
            {
              step: 0,
              toolName: "search_documents",
              type: "DOCUMENT",
              status: "COMPLETED",
              durationMs: 143,
              errorCode: null,
              arguments: { query: "ความเร็ว" },
              summary: "พบ 6 ส่วน",
            },
          ],
        },
      }),
    ].join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

async function sendOneTurn() {
  render(
    <UniversalChat
      bots={[]}
      sources={[]}
      conversations={[]}
      initialMessages={[]}
      historyQuery=""
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Ask AI-Sales…"), {
    target: { value: "ถาม" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(screen.getByText("มี 4 ระดับ")).toBeTruthy());
}

describe("universal chat trace", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamedTurn()));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the reasoning visible after the answer arrives", async () => {
    // Regressed twice: first a remount from router.replace, then a state
    // updater assigning the ref during render instead of at event time. Both
    // left the finished turn showing tool steps with the thinking gone.
    await sendOneTurn();

    fireEvent.click(screen.getByRole("button", { name: /ดูกระบวนการ/ }));

    expect(screen.getByText("การคิด รอบ 1")).toBeTruthy();
    expect(screen.getByText("การคิด รอบ 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /การคิด รอบ 1/ }));
    expect(screen.getByText("ผู้ใช้ถามเรื่องความเร็ว")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /การคิด รอบ 2/ }));
    expect(screen.getByText("พอแล้ว ตอบได้")).toBeTruthy();
  });

  it("reports both the rounds and the steps in the summary", async () => {
    await sendOneTurn();

    expect(
      screen.getByRole("button", { name: /ดูกระบวนการ/ }).textContent,
    ).toContain("การคิด 2 รอบ");
    expect(
      screen.getByRole("button", { name: /ดูกระบวนการ/ }).textContent,
    ).toContain("1 ขั้นตอน");
  });

  it("updates the URL without navigating away from the delivered turn", async () => {
    await sendOneTurn();

    expect(window.location.search).toBe("?conversation=conversation-new");
    expect(screen.getByText("มี 4 ระดับ")).toBeTruthy();
  });

  it("shows the turn as think, act, think", async () => {
    await sendOneTurn();

    fireEvent.click(screen.getByRole("button", { name: /ดูกระบวนการ/ }));
    const text =
      screen.getByLabelText("กระบวนการตอบของผู้ช่วย").textContent ?? "";

    expect(text.indexOf("การคิด รอบ 1")).toBeLessThan(
      text.indexOf("ค้นเอกสาร"),
    );
    expect(text.indexOf("ค้นเอกสาร")).toBeLessThan(
      text.indexOf("การคิด รอบ 2"),
    );
  });
});
