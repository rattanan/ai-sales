// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChatSourcePanel,
  selectedChatSourceScope,
  type ChatKnowledgeSource,
} from "@/components/chat/chat-source-panel";

const sources: ChatKnowledgeSource[] = [
  {
    id: "source-sales",
    name: "Quarterly reports",
    type: "FILE",
    folderId: "folder-sales",
    folderName: "Sales",
    documents: [
      { id: "document-q1", name: "Q1.pdf", mimeType: "application/pdf" },
      { id: "document-q2", name: "Q2.pdf", mimeType: "application/pdf" },
    ],
  },
];

function SourcePanelHarness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <ChatSourcePanel
      sources={sources}
      selectedDocumentIds={new Set(selected)}
      onSelectionChange={setSelected}
      onClose={() => undefined}
    />
  );
}

describe("chat source panel", () => {
  afterEach(cleanup);

  it("selects a whole folder and exposes a mixed state for partial files", () => {
    render(<SourcePanelHarness />);

    const folder = screen.getByRole("checkbox", {
      name: "Select folder Sales",
    }) as HTMLInputElement;
    fireEvent.click(folder);

    expect(
      screen.getByRole("checkbox", { name: "Select file Q1.pdf" }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("checkbox", { name: "Select file Q2.pdf" }),
    ).toHaveProperty("checked", true);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select file Q2.pdf" }),
    );

    expect(folder.checked).toBe(false);
    expect(folder.indeterminate).toBe(true);
  });

  it("compresses complete sources while keeping partial file selections", () => {
    expect(
      selectedChatSourceScope(sources, new Set(["document-q1", "document-q2"])),
    ).toEqual({ sourceIds: ["source-sales"], documentIds: [] });
    expect(selectedChatSourceScope(sources, new Set(["document-q1"]))).toEqual({
      sourceIds: [],
      documentIds: ["document-q1"],
    });
  });
});
