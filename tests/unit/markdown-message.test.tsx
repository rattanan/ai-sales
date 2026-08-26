// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";

const NTSP_ANSWER = `นี่คือข้อมูล Service Order ของเลขวงจร **4569J5771** จากระบบ NTSP:

- **รหัสใบคำขอ:** SR1466264  
- **ชื่อลูกค้า:** นางสาวดวงกมล ดาวเรือง  
- **ความเร็ว:** 512 000 / 512 000 Kbps  

ข้อมูลอ้างอิงจาก NTSP SR API [1]`;

afterEach(() => cleanup());

describe("MarkdownMessage", () => {
  it("renders a real assistant answer without crashing", () => {
    render(<MarkdownMessage content={NTSP_ANSWER} />);

    expect(screen.getByText(/Service Order/)).toBeTruthy();
    expect(screen.getByText("SR1466264")).toBeTruthy();
  });

  it("renders a GFM table", () => {
    render(<MarkdownMessage content={"| a | b |\n|---|---|\n| 1 | 2 |"} />);

    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("turns citation markers into buttons when a handler is given", () => {
    const onCite = vi.fn();
    render(<MarkdownMessage content="ตอบแล้ว [3]" onCite={onCite} />);

    const chip = screen.getByRole("button", { name: /3/ });
    chip.click();

    expect(onCite).toHaveBeenCalledWith(3);
  });

  it("connects a citation marker to its source preview", () => {
    render(
      <MarkdownMessage
        content="ตอบจากเว็บ [1]"
        citations={[
          {
            id: "citation-1",
            rank: 1,
            quote: "ข้อความจากผลการค้นหา",
            metadata: {
              title: "Current source",
              url: "https://example.com/current",
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Current source/ }));

    expect(screen.getByRole("dialog", { name: /Current source/ })).toBeTruthy();
    expect(screen.getByText("ข้อความจากผลการค้นหา")).toBeTruthy();
  });

  it("escapes raw HTML instead of executing it", () => {
    const { container } = render(
      <MarkdownMessage content={'<img src=x onerror="alert(1)">ok'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("ok");
  });

  it("drops a javascript: link to plain text", () => {
    const { container } = render(
      <MarkdownMessage content="[click](javascript:alert(1))" />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click");
  });

  it("renders a fenced code block", () => {
    const { container } = render(
      <MarkdownMessage content={"```ts\nconst a = 1;\n```"} />,
    );

    expect(container.querySelector("pre code")).toBeTruthy();
  });

  it("renders math without throwing", () => {
    const { container } = render(
      <MarkdownMessage content={"ค่า $x^2 + y^2 = z^2$ ครับ"} />,
    );

    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("breaks a long unbroken string instead of overflowing the bubble", () => {
    const { container } = render(
      <MarkdownMessage
        content="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTam9OCjhZ0K4lL_3m5HkrAOcJN24PtbEUhdkNjUWMyjA77bw68GVs22EemJdK4lZcmNewN1dG6jJw"
        citations={[]}
      />,
    );

    // A pasted URL has no break opportunity, so without this it runs straight
    // out past the right edge of the message.
    expect(container.firstElementChild?.className).toContain("break-words");
  });
});
