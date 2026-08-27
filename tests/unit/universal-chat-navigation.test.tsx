// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniversalChat } from "@/components/chat/universal-chat";
import { WorkspaceMobileChromeProvider } from "@/components/layout/workspace-mobile-chrome";
import { submitMessageFeedbackAction } from "@/features/chat/actions";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/features/chat/actions", () => ({
  deleteConversationAction: vi.fn(),
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
          botName: "AI-Sales Assistant",
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
      screen.getByRole("heading", {
        name: "From a question to a record in NTOP",
      }),
    ).toBeTruthy();
  });

  it("starts a usable sentence from a starter prompt instead of its label", () => {
    renderChat();

    fireEvent.click(screen.getByRole("link", { name: /new chat/i }));
    fireEvent.click(screen.getByRole("button", { name: /a new company/i }));

    const field = screen.getByRole("textbox", { name: "Message AI-Sales" });
    expect((field as HTMLTextAreaElement).value).toBe(
      "Check NTOP for this company, and propose a prospect if it is not there yet: ",
    );
    expect(document.activeElement).toBe(field);
  });

  it("retries a user message without clearing the composer draft", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `event: result\ndata: ${JSON.stringify({
          conversation: { id: "conversation-1" },
          userMessage: { id: "message-user-2", content: "Original question" },
          assistantMessage: {
            id: "message-assistant-2",
            role: "ASSISTANT",
            content: "Retried answer",
            citations: [],
          },
        })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    render(
      <UniversalChat
        bots={[]}
        sources={[]}
        conversations={[]}
        selectedConversationId="conversation-1"
        initialMessages={[
          {
            id: "message-user-1",
            role: "USER",
            content: "Original question",
            createdAt: "2026-08-26T10:00:00.000Z",
            citations: [],
          },
        ]}
        historyQuery=""
      />,
    );
    const composer = screen.getByPlaceholderText("Ask AI-Sales…");
    fireEvent.change(composer, { target: { value: "Unsent draft" } });

    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(options?.body as string)).toMatchObject({
      message: "Original question",
    });
    expect((composer as HTMLTextAreaElement).value).toBe("Unsent draft");
  });

  it("edits and resends a user message inline", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `event: result\ndata: ${JSON.stringify({
          conversation: { id: "conversation-1" },
          userMessage: { id: "message-user-2", content: "Corrected question" },
          assistantMessage: {
            id: "message-assistant-2",
            role: "ASSISTANT",
            content: "Corrected answer",
            citations: [],
          },
        })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    render(
      <UniversalChat
        bots={[]}
        sources={[]}
        conversations={[]}
        selectedConversationId="conversation-1"
        initialMessages={[
          {
            id: "message-user-1",
            role: "USER",
            content: "Original question",
            createdAt: "2026-08-26T10:00:00.000Z",
            citations: [],
          },
        ]}
        historyQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    fireEvent.change(editor, { target: { value: "Corrected question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(options?.body as string)).toMatchObject({
      message: "Corrected question",
    });
  });

  it("lays out the sales workflow as three ordered steps", () => {
    renderChat();

    fireEvent.click(screen.getByRole("link", { name: /new chat/i }));

    const steps = screen.getByRole("list").querySelectorAll("li");
    expect(steps).toHaveLength(3);
    expect(steps[0]?.textContent).toContain("Search");
    expect(steps[2]?.textContent).toContain("Propose the record");
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

    fireEvent.change(screen.getByPlaceholderText("Ask AI-Sales…"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    // The URL is rewritten without a router navigation. Navigating would
    // remount the chat (the page is keyed by conversation id) and replace the
    // just-delivered answer and its reasoning trace with whatever the server
    // has stored — which is nothing yet on the first turn.
    await waitFor(() =>
      expect(window.location.search).toBe(
        "?conversation=conversation%2Fnew%20id",
      ),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries the think level chosen in the composer into the request", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `event: result\ndata: ${JSON.stringify({
          conversation: { id: "conversation-think" },
          userMessage: { id: "message-user", content: "Deep question" },
          assistantMessage: {
            id: "message-assistant",
            role: "ASSISTANT",
            content: "Answer",
            citations: [],
          },
        })}\n\n`,
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

    fireEvent.click(screen.getByRole("combobox", { name: "Think level" }));
    fireEvent.click(screen.getByRole("option", { name: /คิดลึก/ }));
    fireEvent.change(screen.getByPlaceholderText("Ask AI-Sales…"), {
      target: { value: "Deep question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(options?.body as string)).toMatchObject({
      reasoningEffort: "high",
    });
  });

  it("uses the remembered think level without the reader touching the pill", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `event: result\ndata: ${JSON.stringify({
          conversation: { id: "conversation-remembered" },
          userMessage: { id: "message-user", content: "Remembered" },
          assistantMessage: {
            id: "message-assistant",
            role: "ASSISTANT",
            content: "Answer",
            citations: [],
          },
        })}\n\n`,
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
        initialThinkLevel="medium"
      />,
    );

    // Rendered from the cookie the server read, so the pill shows the saved
    // choice on first paint rather than flipping to it after hydration.
    expect(
      screen.getByRole("combobox", { name: "Think level" }).textContent,
    ).toContain("คิดกลาง");
    fireEvent.change(screen.getByPlaceholderText("Ask AI-Sales…"), {
      target: { value: "Remembered" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(options?.body as string)).toMatchObject({
      reasoningEffort: "medium",
    });
  });

  it("remembers a newly picked think level in a cookie", () => {
    render(
      <UniversalChat
        bots={[]}
        sources={[]}
        conversations={[]}
        initialMessages={[]}
        historyQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Think level" }));
    fireEvent.click(screen.getByRole("option", { name: /คิดเร็ว/ }));

    expect(document.cookie).toContain("insightkm-think-level=low");
    document.cookie = "insightkm-think-level=; Path=/; Max-Age=0";
  });

  it("sends on Enter from the composer", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `event: result\ndata: ${JSON.stringify({
          conversation: { id: "conversation-enter" },
          userMessage: { id: "message-user", content: "Quick question" },
          assistantMessage: {
            id: "message-assistant",
            role: "ASSISTANT",
            content: "Answer",
            citations: [],
          },
        })}\n\n`,
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

    const field = screen.getByPlaceholderText("Ask AI-Sales…");
    fireEvent.change(field, { target: { value: "Quick question" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("sends a partial file selection as document-scoped retrieval", async () => {
    const result = {
      conversation: { id: "conversation-files" },
      userMessage: { id: "message-user", content: "Compare targets" },
      assistantMessage: {
        id: "message-assistant",
        role: "ASSISTANT",
        content: "Compared",
        citations: [],
      },
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(`event: result\ndata: ${JSON.stringify(result)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    render(
      <UniversalChat
        bots={[]}
        sources={[
          {
            id: "source-sales",
            name: "Quarterly reports",
            type: "FILE",
            folderId: "folder-sales",
            folderName: "Sales",
            documents: [
              {
                id: "document-q1",
                name: "Q1.pdf",
                mimeType: "application/pdf",
              },
              {
                id: "document-q2",
                name: "Q2.pdf",
                mimeType: "application/pdf",
              },
            ],
          },
        ]}
        conversations={[]}
        initialMessages={[]}
        historyQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select file Q1.pdf" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Ask AI-Sales…"), {
      target: { value: "Compare targets" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(options?.body as string)).toMatchObject({
      scope: "SPECIFIC_SOURCES",
      sourceIds: [],
      documentIds: ["document-q1"],
    });
  });
  it("sizes a user bubble to its own text and leaves the answer full width", () => {
    render(
      <UniversalChat
        bots={[]}
        sources={[]}
        conversations={[]}
        initialMessages={[
          {
            id: "user-1",
            role: "USER",
            content: "สรุปให้หน่อย",
            citations: [],
          },
          {
            id: "assistant-1",
            role: "ASSISTANT",
            content: "Here is the summary",
            citations: [],
          },
        ]}
        historyQuery=""
      />,
    );

    // A short question stretched across the whole column read as an empty banner.
    const question = screen.getByText("สรุปให้หน่อย");
    expect(question.className).toContain("w-fit");
    const answer = screen
      .getByText("Here is the summary")
      .closest("div.rounded-2xl");
    expect(answer?.className).not.toContain("w-fit");
  });
});

function installDialogMethods() {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    },
  });
}

describe("conversation history drawer", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function openDrawer() {
    const trigger = screen.getByRole("button", {
      name: "Show conversation history",
    });
    fireEvent.click(trigger);
    return trigger;
  }

  it("opens from the header as a dialog and parks the chat behind it", () => {
    renderChat();
    expect(screen.queryByRole("dialog")).toBeNull();

    const trigger = openDrawer();

    const drawer = screen.getByRole("dialog", { name: "Conversation history" });
    expect(drawer.id).toBe(trigger.getAttribute("aria-controls"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // The chat is still on screen but nothing in it can take a tap or focus.
    expect(document.querySelector("section")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(
      within(drawer).getByRole("button", {
        name: "Close conversation history",
      }),
    );
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    renderChat();
    const trigger = openDrawer();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("chat-history")?.className).toContain(
      "invisible",
    );
    expect(document.querySelector("section")?.hasAttribute("inert")).toBe(
      false,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the scrim is tapped", () => {
    renderChat();
    openDrawer();
    const drawer = screen.getByRole("dialog", { name: "Conversation history" });

    const scrim = screen
      .getAllByRole("button", { name: "Close conversation history" })
      .find((button) => !drawer.contains(button));
    fireEvent.click(scrim!);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes as soon as a conversation is picked", () => {
    renderChat();
    openDrawer();

    fireEvent.click(
      screen.getByRole("link", { name: /existing conversation/i }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the drawer alone when Escape is meant for the delete dialog", () => {
    installDialogMethods();
    renderChat();
    openDrawer();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete conversation: Existing conversation",
      }),
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Escape",
    });

    // The native dialog owns that keystroke; the sheet behind it stays put.
    expect(
      screen.getByRole("dialog", { name: "Conversation history" }),
    ).toBeTruthy();
  });

  it("hosts the shell's mobile controls at either end of its header", () => {
    render(
      <WorkspaceMobileChromeProvider
        value={{
          start: <button type="button">Workspace menu</button>,
          end: <button type="button">Account</button>,
        }}
      >
        <UniversalChat
          bots={[]}
          sources={[]}
          conversations={[]}
          initialMessages={[]}
          historyQuery=""
        />
      </WorkspaceMobileChromeProvider>,
    );

    const header = screen
      .getByRole("heading", { name: "Universal Chat" })
      .closest("header");
    const buttons = within(header!).getAllByRole("button");
    expect(buttons[0].textContent).toBe("Workspace menu");
    expect(buttons[buttons.length - 1].textContent).toBe("Account");
  });

  it("stays out of the way on a wide screen", () => {
    renderChat();

    // Closed, the panel is a plain aside: the column the desktop layout shows.
    const panel = document.getElementById("chat-history");
    expect(panel?.getAttribute("role")).toBeNull();
    expect(panel?.className).toContain("xl:static");
    expect(
      screen.getByRole("button", { name: "Show conversation history" })
        .className,
    ).toContain("xl:hidden");
  });
});
