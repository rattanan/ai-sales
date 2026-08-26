// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteConversationAction } from "@/features/chat/actions";
import { ConversationDeleteButton } from "@/components/chat/conversation-delete-button";

vi.mock("@/features/chat/actions", () => ({
  deleteConversationAction: vi.fn(),
}));

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

describe("ConversationDeleteButton", () => {
  beforeEach(() => {
    installDialogMethods();
    vi.mocked(deleteConversationAction).mockReset();
  });

  afterEach(() => cleanup());

  it("asks for confirmation without deleting when cancelled", () => {
    render(
      <ConversationDeleteButton
        conversationId="conversation-1"
        conversationTitle="August sales"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete conversation: August sales",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Delete this conversation?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteConversationAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes the selected conversation and reports completion", async () => {
    const onDeleted = vi.fn();
    vi.mocked(deleteConversationAction).mockResolvedValue(undefined);
    render(
      <ConversationDeleteButton
        conversationId="conversation-2"
        conversationTitle="Pipeline review"
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete conversation: Pipeline review",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete conversation" }),
    );

    await waitFor(() => expect(deleteConversationAction).toHaveBeenCalled());
    const formData = vi.mocked(deleteConversationAction).mock.calls[0]?.[0];
    expect(formData?.get("conversationId")).toBe("conversation-2");
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open and shows an error when deletion fails", async () => {
    vi.mocked(deleteConversationAction).mockRejectedValue(
      new Error("Database unavailable"),
    );
    render(
      <ConversationDeleteButton
        conversationId="conversation-3"
        conversationTitle="Quarterly plan"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete conversation: Quarterly plan",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete conversation" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not delete the conversation. Try again.",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
