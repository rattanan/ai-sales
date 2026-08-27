// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/workspace" }));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/features/auth/actions", () => ({
  logoutAction: vi.fn(),
}));

import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { WorkspaceMobileChrome } from "@/components/layout/workspace-mobile-chrome";

const navigation = {
  chat: true,
  botUse: true,
  botManagement: false,
  knowledgeManagement: true,
  dataConnections: false,
  legacyApis: false,
  insights: false,
  providerManagement: false,
  authenticationManagement: false,
  userManagement: false,
  roleManagement: false,
  storageManagement: false,
  workerManagement: false,
  privacyManagement: false,
  auditAccess: false,
  systemHealth: false,
};

function renderShell(initialSidebarCollapsed = false) {
  return render(
    <WorkspaceShell
      initialLocale="en"
      initialSidebarCollapsed={initialSidebarCollapsed}
      workspace={{ name: "Sales workspace", organizationName: "NT" }}
      user={{ name: "Pong", email: "pong@example.com" }}
      navigation={navigation}
    >
      <header data-testid="page-header">
        <WorkspaceMobileChrome slot="start" />
        <h1>Page content</h1>
        <WorkspaceMobileChrome slot="end" />
      </header>
    </WorkspaceShell>,
  );
}

describe("workspace mobile chrome", () => {
  afterEach(() => {
    cleanup();
    route.pathname = "/workspace";
  });

  it("keeps its own bar and hands nothing over on an ordinary page", () => {
    renderShell();

    expect(document.querySelector("header")?.className).not.toContain(
      "max-lg:hidden",
    );
    expect(
      screen.getByTestId("page-header").querySelector("summary"),
    ).toBeNull();
  });

  it("hands its menu and account controls to a chat screen below lg", () => {
    route.pathname = "/workspace/chat";
    renderShell();

    // The shell bar steps aside on small screens; the page shows the controls.
    expect(document.querySelector("header")?.className).toContain(
      "max-lg:hidden",
    );
    const pageHeader = screen.getByTestId("page-header");
    expect(
      pageHeader.querySelector('[aria-label="Open navigation"]'),
    ).not.toBeNull();
    expect(
      pageHeader.querySelector('[aria-label="Account menu"]'),
    ).not.toBeNull();
    // The language toggle has no room in that row, so the menu carries it.
    expect(
      pageHeader.querySelector('button[type="button"]')?.textContent,
    ).toContain("Switch to Thai");
  });
});

describe("workspace sidebar toggle", () => {
  afterEach(() => {
    cleanup();
    document.cookie = "insightkm-sidebar=; Path=/; Max-Age=0";
  });

  it("collapses the sidebar to an icon rail and remembers the choice", () => {
    renderShell();
    // Two controls, one action: the chevron on the edge and the labelled
    // button at the foot of the sidebar.
    const collapse = screen.getAllByRole("button", {
      name: "Collapse sidebar",
    });
    expect(collapse).toHaveLength(2);
    for (const button of collapse)
      expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Knowledge workspace active")).toBeTruthy();

    fireEvent.click(collapse[0]);

    const expand = screen.getAllByRole("button", { name: "Expand sidebar" });
    expect(expand).toHaveLength(2);
    for (const button of expand)
      expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("workspace-sidebar")?.className).toContain(
      "lg:w-[76px]",
    );
    // The workspace card has no room in the rail; the nav keeps its names.
    expect(screen.queryByText("Knowledge workspace active")).toBeNull();
    expect(document.cookie).toContain("insightkm-sidebar=collapsed");
  });

  it("starts collapsed when the cookie asked for it", () => {
    renderShell(true);

    const expand = screen.getAllByRole("button", { name: "Expand sidebar" });
    expect(expand[0].getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("workspace-sidebar")?.className).toContain(
      "lg:w-[76px]",
    );

    // The footer button works the same way as the edge chevron.
    fireEvent.click(expand[1]);

    expect(document.getElementById("workspace-sidebar")?.className).toContain(
      "lg:w-[272px]",
    );
    expect(document.cookie).toContain("insightkm-sidebar=expanded");
  });
});
