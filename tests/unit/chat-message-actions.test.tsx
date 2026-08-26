// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatMessageActions,
  ChatMessageEditor,
  formatChatRelativeTime,
} from "@/components/chat/chat-message-actions";
import { WorkspaceLocaleProvider } from "@/components/layout/workspace-locale";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("chat message actions", () => {
  it("formats relative timestamps in English and Thai", () => {
    const now = new Date("2026-08-26T12:00:00.000Z").getTime();
    const createdAt = "2026-08-24T12:00:00.000Z";

    expect(formatChatRelativeTime(createdAt, now, "en")).toBe("2 days ago");
    expect(formatChatRelativeTime(createdAt, now, "th")).toBe("2 วันที่แล้ว");
  });

  it("exposes retry, edit, and copy as labelled buttons", async () => {
    const retry = vi.fn();
    const edit = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ChatMessageActions
        content="Compare quarterly sales"
        createdAt="2026-08-24T12:00:00.000Z"
        now={new Date("2026-08-26T12:00:00.000Z").getTime()}
        align="end"
        onRetry={retry}
        onEdit={edit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    expect(retry).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Compare quarterly sales"),
    );
    expect(
      await screen.findByRole("button", { name: "Message copied" }),
    ).toBeTruthy();
  });

  it("keeps the controls collapsed so the timestamp sits flush to the edge", () => {
    render(
      <ChatMessageActions
        content="Compare quarterly sales"
        createdAt="2026-08-24T12:00:00.000Z"
        now={new Date("2026-08-26T12:00:00.000Z").getTime()}
        align="end"
        onRetry={vi.fn()}
      />,
    );

    // Fading alone still reserved the width, which pushed the timestamp off the
    // right edge while the controls were invisible.
    const collapsing = screen
      .getByRole("button", { name: "Retry message" })
      .closest("div.grid");
    expect(collapsing?.className).toContain("grid-cols-[0fr]");
    expect(collapsing?.className).toContain(
      "group-hover/message:grid-cols-[1fr]",
    );
  });

  it("localizes action labels and submits an inline edit from the keyboard", () => {
    const submit = vi.fn();
    render(
      <WorkspaceLocaleProvider initialLocale="th">
        <ChatMessageEditor
          content="ยอดขายเดิม"
          onCancel={vi.fn()}
          onSubmit={submit}
        />
      </WorkspaceLocaleProvider>,
    );

    const editor = screen.getByRole("textbox", { name: "แก้ไขข้อความนี้" });
    fireEvent.change(editor, { target: { value: "ยอดขายที่แก้ไขแล้ว" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(submit).toHaveBeenCalledWith("ยอดขายที่แก้ไขแล้ว");
  });
});
