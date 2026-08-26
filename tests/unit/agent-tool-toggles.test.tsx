// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentToolToggles } from "@/components/knowledge/agent-tool-toggles";

describe("agent display tool toggles", () => {
  afterEach(cleanup);

  it("starts display tools off for a new bot but lets all three be enabled", () => {
    const { container } = render(<AgentToolToggles />);
    const displayButtons = [
      screen.getByRole("button", { name: /แสดง QR Code/ }),
      screen.getByRole("button", { name: /แสดงกราฟ/ }),
      screen.getByRole("button", { name: /แสดงรูปภาพ/ }),
    ];
    const iconMarkup = displayButtons.map(
      (button) => button.querySelector("svg")?.outerHTML,
    );

    expect(new Set(iconMarkup).size).toBe(3);
    expect(iconMarkup[0]).toContain("qr-code");
    expect(iconMarkup[1]).toContain("chart");
    expect(iconMarkup[2]).toContain("image");

    for (const button of displayButtons) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }

    expect(
      container.querySelectorAll('input[name="disabledTools"]'),
    ).toHaveLength(0);
  });

  it("honours an existing bot with every tool enabled", () => {
    render(<AgentToolToggles disabledTools={[]} />);

    expect(
      screen
        .getByRole("button", { name: /แสดง QR Code/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
