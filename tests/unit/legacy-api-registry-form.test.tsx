// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: () => [null, vi.fn(), false],
  };
});

vi.mock("@/features/legacy-api/actions", () => ({
  deleteLegacyApiAction: vi.fn(),
  generateLegacyApiToolDefinitionAction: vi.fn(),
  saveLegacyApiAction: vi.fn(),
  testLegacyApiDraftAction: vi.fn(),
}));

import { LegacyApiRegistryForm } from "@/components/admin/legacy-api-registry-form";

describe("LegacyApiRegistryForm", () => {
  afterEach(cleanup);

  it("collects API key header credentials before the test action", () => {
    render(<LegacyApiRegistryForm bots={[]} />);

    fireEvent.change(
      screen.getByLabelText(/API endpoint URL/, { selector: "input" }),
      {
        target: {
          value:
            "https://api.example.com/index.php?r=api%2Forders&query={query}",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Detect input fields" }),
    );

    const authenticationType = screen.getByLabelText(/Authentication type/, {
      selector: "select",
    });
    const testButton = screen.getByRole("button", { name: "Test API" });
    expect(
      authenticationType.compareDocumentPosition(testButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(authenticationType, { target: { value: "API_KEY" } });
    fireEvent.change(
      screen.getByLabelText(/API key header/, { selector: "input" }),
      { target: { value: "x-api-key" } },
    );
    fireEvent.change(
      screen.getByLabelText(/^API key(?: \*)?$/, { selector: "input" }),
      { target: { value: "test-secret" } },
    );

    const form = testButton.closest("form");
    expect(form).not.toBeNull();
    const formData = new FormData(form!);
    expect(formData.get("authType")).toBe("API_KEY");
    expect(formData.get("apiKeyHeaderName")).toBe("x-api-key");
    expect(formData.get("apiKey")).toBe("test-secret");
  });
});
