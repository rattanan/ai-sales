// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/features/knowledge/source-actions", () => ({
  reindexSourceWithFeedbackAction: vi.fn(),
}));

import { SourceReindexForm } from "@/components/sources/source-reindex-form";

afterEach(() => cleanup());

describe("SourceReindexForm", () => {
  it("explains when indexing is already active", () => {
    render(
      <SourceReindexForm
        sourceId="source-1"
        activeJobCount={1}
        reindexableJobCount={0}
        hasDocumentVersion
      />,
    );

    const button = screen.getByRole("button", {
      name: "Indexing in progress",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText(
        "Indexing is already in progress. This page refreshes automatically.",
      ),
    ).toBeTruthy();
  });

  it("allows a terminal document job to be queued again", () => {
    render(
      <SourceReindexForm
        sourceId="source-1"
        activeJobCount={0}
        reindexableJobCount={1}
        hasDocumentVersion
      />,
    );

    const button = screen.getByRole("button", {
      name: "Re-index documents",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
