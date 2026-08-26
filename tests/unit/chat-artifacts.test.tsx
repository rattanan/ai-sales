// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatArtifactList } from "@/components/chat/chat-artifacts";

describe("chat artifacts", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  afterEach(cleanup);

  it("renders a chart with an accessible data table and visible controls", () => {
    render(
      <ChatArtifactList
        artifacts={[
          {
            id: "chart-1",
            kind: "chart",
            type: "bar",
            title: "Revenue",
            svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            labels: ["Jan", "Feb"],
            datasets: [{ label: "Sales", data: [10, 20] }],
            valueSuffix: " บาท",
          },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Revenue" })).toBeTruthy();
    expect(screen.getByText("Chart data")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Sales" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Download: Revenue/ }),
    ).toBeTruthy();
  });

  it("opens a keyboard-dismissable native dialog and restores focus", () => {
    render(
      <ChatArtifactList
        artifacts={[
          {
            id: "qr-1",
            kind: "qr",
            label: "Payment",
            svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          },
        ]}
      />,
    );
    const opener = screen.getByRole("button", {
      name: "Open full size: Payment",
    });

    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: /Payment/ });
    expect(dialog.hasAttribute("open")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
