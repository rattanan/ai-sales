// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PromptInput,
  PromptInputActions,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ui/prompt-input";

function Composer({
  onSubmit,
  loading = false,
  value = "Draft",
}: {
  onSubmit: () => void;
  loading?: boolean;
  value?: string;
}) {
  return (
    <PromptInput
      value={value}
      onValueChange={() => {}}
      onSubmit={onSubmit}
      loading={loading}
      data-testid="composer"
    >
      <PromptInputTextarea aria-label="Message" placeholder="Ask anything…" />
      <PromptInputToolbar>
        <PromptInputActions>
          <PromptInputButton active aria-pressed>
            Search
          </PromptInputButton>
        </PromptInputActions>
        <PromptInputSubmit />
      </PromptInputToolbar>
    </PromptInput>
  );
}

describe("prompt input", () => {
  afterEach(() => cleanup());

  it("sends on Enter", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the newline on Shift + Enter", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByLabelText("Message"), {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still sends on Ctrl + Enter, which this composer used to require", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByLabelText("Message"), {
      key: "Enter",
      ctrlKey: true,
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores the Enter that commits an IME candidate", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByLabelText("Message"), {
      key: "Enter",
      isComposing: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("focuses the field when the padding around the controls is clicked", () => {
    render(<Composer onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByTestId("composer"));

    expect(document.activeElement).toBe(screen.getByLabelText("Message"));
  });

  it("leaves focus on a toolbar button that was just pressed", () => {
    render(<Composer onSubmit={vi.fn()} />);
    const search = screen.getByRole("button", { name: "Search" });
    search.focus();

    fireEvent.click(search);

    expect(document.activeElement).toBe(search);
  });

  it("blocks send while a turn is in flight", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} loading />);

    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.click(send);
    // The field stays typeable, but Enter neither submits nor leaves a stray
    // newline behind while the previous turn is still streaming.
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the marker that suppresses the app-wide focus outline", () => {
    render(<Composer onSubmit={vi.fn()} />);

    // Paired with a rule in app/globals.css. Dropping the class here brings the
    // 3px outline back around the bare textarea, inside the composer's own ring.
    expect(
      screen.getByLabelText("Message").classList.contains("prompt-input-field"),
    ).toBe(true);
  });
});
