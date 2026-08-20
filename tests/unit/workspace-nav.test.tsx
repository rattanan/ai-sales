// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/admin/knowledge",
  useSearchParams: () => new URLSearchParams(),
}));

import { WorkspaceNav } from "@/components/layout/workspace-nav";
import { translateWorkspaceText } from "@/lib/workspace-i18n";

afterEach(() => cleanup());

const access = {
  chat: true,
  botUse: true,
  botManagement: true,
  knowledgeManagement: true,
  dataConnections: true,
  legacyApis: true,
  insights: true,
  providerManagement: true,
  authenticationManagement: true,
  userManagement: true,
  roleManagement: true,
  storageManagement: true,
  workerManagement: true,
  privacyManagement: true,
  auditAccess: true,
  systemHealth: true,
};

describe("WorkspaceNav", () => {
  it("shows All knowledge under Sources and Manage Source under System Admin", () => {
    render(<WorkspaceNav {...access} />);

    const sources = screen.getByText("Sources").closest("details");
    const systemAdmin = screen.getByText("System Admin").closest("details");

    expect(sources).not.toBeNull();
    expect(systemAdmin).not.toBeNull();
    expect(
      within(sources!)
        .getByRole("link", { name: "All knowledge" })
        .getAttribute("href"),
    ).toBe("/workspace/admin/knowledge");
    expect(
      within(systemAdmin!)
        .getByRole("link", { name: "Manage Source" })
        .getAttribute("href"),
    ).toBe("/workspace/sources");
    expect(screen.queryByText("Knowledge Folders")).toBeNull();
  });

  it("translates the renamed menu items to Thai", () => {
    expect(translateWorkspaceText("All knowledge", "th")).toBe(
      "ความรู้ทั้งหมด",
    );
    expect(translateWorkspaceText("Manage Source", "th")).toBe(
      "จัดการแหล่งข้อมูล",
    );
  });
});
