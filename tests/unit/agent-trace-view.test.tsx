// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AgentTrace,
  type AgentTraceEntry,
} from "@/components/chat/agent-trace";

const reasoning: AgentTraceEntry = {
  kind: "reasoning",
  step: 0,
  text: "ผู้ใช้ถามเรื่องความเร็ว ควรค้นเอกสารก่อน",
  done: true,
};

const tool: AgentTraceEntry = {
  kind: "tool",
  step: 0,
  toolCallId: "call-a",
  toolName: "search_documents",
  type: "DOCUMENT",
  status: "COMPLETED",
  durationMs: 143,
  errorCode: null,
  arguments: { query: "ระดับความเร็ว" },
  summary: "พบเนื้อหาที่เกี่ยวข้อง 6 ส่วน",
};

afterEach(() => cleanup());

describe("AgentTrace", () => {
  it("shows reasoning after the turn finishes", () => {
    // Regression: a stale closure dropped the reasoning the moment the answer
    // landed, so a finished turn rendered tool steps only.
    render(<AgentTrace entries={[reasoning, tool]} />);

    fireEvent.click(screen.getByRole("button", { name: /ดูกระบวนการ/ }));
    expect(screen.getByText("การคิด รอบ 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /การคิด รอบ 1/ }));
    expect(screen.getByText(/ควรค้นเอกสารก่อน/)).toBeTruthy();
  });

  it("renders in the order the turn happened", () => {
    const { container } = render(
      <AgentTrace
        entries={[
          reasoning,
          tool,
          { kind: "reasoning", step: 1, text: "คิดต่อ", done: true },
        ]}
        live
      />,
    );
    const text = container.textContent ?? "";

    expect(text.indexOf("การคิด รอบ 1")).toBeLessThan(
      text.indexOf("ค้นเอกสาร"),
    );
    expect(text.indexOf("ค้นเอกสาร")).toBeLessThan(
      text.indexOf("การคิด รอบ 2"),
    );
  });

  it("summarises the turn without expanding it", () => {
    render(<AgentTrace entries={[reasoning, tool]} />);

    const header = screen.getByRole("button", { name: /ดูกระบวนการ/ });
    expect(header.textContent).toContain("การคิด 1 รอบ");
    expect(header.textContent).toContain("1 ขั้นตอน");
    expect(header.textContent).toContain("143 ms");
    // Collapsed by default once finished.
    expect(screen.queryByText(/ควรค้นเอกสารก่อน/)).toBeNull();
  });

  it("starts expanded while the turn is still running", () => {
    render(
      <AgentTrace
        entries={[{ ...reasoning, done: false, text: "กำลังคิด" }]}
        live
      />,
    );

    // The trace itself is open; each round is opened on demand.
    expect(screen.getByRole("button", { name: /การคิด รอบ 1/ })).toBeTruthy();
  });

  it("reveals a tool's arguments and result on demand", () => {
    render(<AgentTrace entries={[tool]} live />);

    fireEvent.click(screen.getByRole("button", { name: /ค้นเอกสาร/ }));

    expect(screen.getByText(/ระดับความเร็ว/)).toBeTruthy();
    expect(screen.getByText(/พบเนื้อหาที่เกี่ยวข้อง 6 ส่วน/)).toBeTruthy();
  });

  it("flags a failed step with its error code", () => {
    render(
      <AgentTrace
        entries={[
          {
            ...tool,
            status: "FAILED",
            errorCode: "DATABASE_QUERY_ERROR",
          } as AgentTraceEntry,
        ]}
        live
      />,
    );

    expect(screen.getByText("DATABASE_QUERY_ERROR")).toBeTruthy();
    expect(screen.getByText(/1 รายการไม่สำเร็จ/)).toBeTruthy();
  });

  it("renders nothing for a turn that used neither", () => {
    const { container } = render(<AgentTrace entries={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders a reload-only turn that has no reasoning", () => {
    render(<AgentTrace entries={[tool]} />);

    const header = screen.getByRole("button", { name: /ดูกระบวนการ/ });
    expect(header.textContent).not.toContain("การคิด");
    expect(header.textContent).toContain("1 ขั้นตอน");
  });
});

describe("reasoning rounds", () => {
  it("shows each round separately instead of appending to the first", () => {
    // Appending later rounds onto the first block read as one thought that
    // restarted mid-sentence.
    render(
      <AgentTrace
        entries={[
          { kind: "reasoning", step: 0, text: "รอบแรกคิดว่า", done: true },
          { kind: "reasoning", step: 1, text: "รอบสองคิดว่า", done: true },
          tool,
        ]}
        live
      />,
    );

    expect(screen.getByText("การคิด รอบ 1")).toBeTruthy();
    expect(screen.getByText("การคิด รอบ 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /การคิด รอบ 2/ }));
    expect(screen.getByText("รอบสองคิดว่า")).toBeTruthy();
  });

  it("counts the rounds in the collapsed summary", () => {
    render(
      <AgentTrace
        entries={[
          { kind: "reasoning", step: 0, text: "หนึ่ง", done: true },
          { kind: "reasoning", step: 1, text: "สอง", done: true },
          tool,
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /ดูกระบวนการ/ }).textContent,
    ).toContain("การคิด 2 รอบ");
  });

  it("ignores a round that produced no text", () => {
    render(
      <AgentTrace
        entries={[
          { kind: "reasoning", step: 0, text: "   ", done: true },
          { kind: "reasoning", step: 1, text: "มีเนื้อหา", done: true },
        ]}
        live
      />,
    );

    expect(screen.getByText("การคิด รอบ 1")).toBeTruthy();
    expect(screen.queryByText("การคิด รอบ 2")).toBeNull();
  });

  it("says so when a stored round was cut short", () => {
    render(
      <AgentTrace
        entries={[
          {
            kind: "reasoning",
            step: 0,
            text: "คิดยาวมาก",
            done: true,
            truncated: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ดูกระบวนการ/ }));
    fireEvent.click(screen.getByRole("button", { name: /การคิด รอบ 1/ }));

    expect(
      screen.getByText(/ตัดส่วนที่เหลือของรอบนี้ออกตอนบันทึก/),
    ).toBeTruthy();
  });
});
