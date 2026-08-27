// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Brain } from "lucide-react";
import { SelectMenu } from "@/components/ui/select-menu";

const OPTIONS = [
  { value: "auto", label: "Auto", hint: "Assistant picks" },
  { value: "search", label: "Search" },
  { value: "summarize", label: "Summarize" },
];

function renderMenu(onChange = vi.fn(), value = "auto") {
  render(
    <SelectMenu
      label="Mode"
      value={value}
      options={OPTIONS}
      onChange={onChange}
    />,
  );
  return { onChange, trigger: screen.getByRole("combobox", { name: "Mode" }) };
}

describe("select menu", () => {
  afterEach(() => cleanup());

  it("shows the selected label and keeps the list closed", () => {
    const { trigger } = renderMenu();

    expect(trigger.textContent).toContain("Auto");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks only the current value as selected", () => {
    const { trigger } = renderMenu(vi.fn(), "search");
    fireEvent.click(trigger);

    const selected = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true");
    expect(selected.map((option) => option.textContent?.trim())).toEqual([
      "Search",
    ]);
  });

  it("reports the value when an option is clicked", () => {
    const { onChange, trigger } = renderMenu();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("option", { name: "Summarize" }));

    expect(onChange).toHaveBeenCalledWith("summarize");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("walks the list with the arrow keys and commits on Enter", () => {
    const { onChange, trigger } = renderMenu();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("search");
  });

  it("tracks the highlighted row with aria-activedescendant", () => {
    const { trigger } = renderMenu();

    fireEvent.keyDown(trigger, { key: "End" });

    const active = document.getElementById(
      trigger.getAttribute("aria-activedescendant") ?? "",
    );
    expect(active?.textContent?.trim()).toBe("Summarize");
  });

  it("jumps to a typed prefix the way a native select does", () => {
    const { onChange, trigger } = renderMenu();

    fireEvent.keyDown(trigger, { key: "s" });

    // Closed: the keystroke selects outright, no popup needed.
    expect(onChange).toHaveBeenCalledWith("search");
  });

  it("closes on Escape without reporting a value", () => {
    const { onChange, trigger } = renderMenu();
    fireEvent.click(trigger);

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes when a press lands outside", () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("cannot be opened while disabled", () => {
    render(
      <SelectMenu
        label="Mode"
        value="auto"
        options={OPTIONS}
        onChange={vi.fn()}
        disabled
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Mode" }));

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("prefixes the value with a caption when the trigger has no label", () => {
    render(
      <SelectMenu
        label="Mode"
        caption="Mode"
        value="auto"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );

    // "Auto" alone says nothing; the caption is what makes a label-less trigger
    // in a toolbar row readable.
    const trigger = screen.getByRole("combobox", { name: "Mode" });
    expect(trigger.textContent).toContain("Mode");
    expect(trigger.textContent).toContain("Auto");
  });

  it("keeps the value readable when a pill is compacted to its icon", () => {
    render(
      <SelectMenu
        label="Mode"
        caption="Mode"
        value="auto"
        options={OPTIONS}
        onChange={vi.fn()}
        variant="pill"
        icon={Brain}
        compactBelow="sm"
      />,
    );

    // Visually the phone sees the icon and chevron only; the name, the text
    // content, and the tooltip still say what is selected.
    const trigger = screen.getByRole("combobox", { name: "Mode" });
    expect(trigger.textContent).toContain("Auto");
    expect(trigger.title).toBe("Mode: Auto");
    const text = trigger.querySelector(".max-sm\\:sr-only");
    expect(text?.textContent).toContain("Auto");
  });

  it("keeps the requested alignment until a real layout says otherwise", () => {
    render(
      <SelectMenu
        label="Mode"
        value="auto"
        options={OPTIONS}
        onChange={vi.fn()}
        variant="pill"
        align="end"
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Mode" }));

    // jsdom reports a zero-size box, which must not be read as overflow.
    expect(screen.getByRole("listbox").className).toContain("right-0");
  });
});
