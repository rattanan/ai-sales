// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/features/knowledge/delete-actions", () => ({
  deleteKnowledgeFolderAction: vi.fn(),
  deleteKnowledgeSourceAction: vi.fn(),
}));

import { DeleteKnowledgeDialog } from "@/components/knowledge/delete-knowledge-dialog";

afterEach(() => cleanup());

describe("DeleteKnowledgeDialog folder trigger", () => {
  it("renders an accessible gray icon-only button for an empty folder", () => {
    render(
      <DeleteKnowledgeDialog
        kind="folder"
        resourceId="rack-empty"
        resourceName="Empty folder"
        documentCount={0}
        compact
      />,
    );

    const button = screen.getByRole("button", {
      name: "Delete folder Empty folder",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("");
    expect(button.className).toContain("text-slate-500");
  });

  it("disables folder deletion when the folder contains documents", () => {
    render(
      <DeleteKnowledgeDialog
        kind="folder"
        resourceId="rack-used"
        resourceName="Used folder"
        documentCount={2}
        compact
      />,
    );

    const button = screen.getByRole("button", {
      name: "Delete folder Used folder",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe(
      "delete-folder-rack-used-blocked",
    );
    expect(
      screen.getByText(
        "This folder contains documents. Remove all documents before deleting the folder.",
      ),
    ).toBeTruthy();
  });
});
