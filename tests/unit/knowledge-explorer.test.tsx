// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/knowledge/delete-knowledge-dialog", () => ({
  DeleteKnowledgeDialog: () => null,
}));

import { KnowledgeExplorer } from "@/components/knowledge/knowledge-explorer";

afterEach(() => cleanup());

describe("KnowledgeExplorer", () => {
  it("shows each uploaded document directly instead of its Files source", () => {
    render(
      <KnowledgeExplorer
        folders={[
          {
            id: "rack-1",
            name: "General Knowledge",
            description: null,
            scope: "GLOBAL",
            botNames: [],
            documentCount: 2,
            sources: [
              {
                id: "source-files",
                name: "Files",
                type: "FILE",
                status: "READY",
                scope: "GLOBAL",
                active: true,
                description: null,
                documentCount: 2,
                chunkCount: 9,
                updatedAt: "20 Aug 2026",
                botNames: ["Assistant"],
                documents: [
                  {
                    id: "document-1",
                    name: "employee-handbook.pdf",
                    mimeType: "application/pdf",
                    status: "INDEXED",
                    chunkCount: 6,
                    updatedAt: "20 Aug 2026",
                  },
                  {
                    id: "document-2",
                    name: "network-guide.docx",
                    mimeType:
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    status: "QUEUED",
                    chunkCount: 0,
                    updatedAt: "20 Aug 2026",
                  },
                ],
              },
              {
                id: "source-web",
                name: "Product website",
                type: "WEB",
                status: "READY",
                scope: "GLOBAL",
                active: true,
                description: null,
                documentCount: 4,
                chunkCount: 20,
                updatedAt: "20 Aug 2026",
                botNames: [],
                documents: [],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("employee-handbook.pdf")).toBeTruthy();
    expect(screen.getByText("network-guide.docx")).toBeTruthy();
    expect(screen.getByText("PDF · INDEXED")).toBeTruthy();
    expect(screen.getByText("DOCX · QUEUED")).toBeTruthy();
    expect(screen.getByText("Product website")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "View details for Files" }),
    ).toBeNull();
    expect(screen.queryByText("Add document")).toBeNull();
  });
});
