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

  it("keeps API key header credentials after a server-action form reset", () => {
    const view = render(<LegacyApiRegistryForm bots={[]} />);

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
    fireEvent.change(
      screen.getByLabelText(/^Query(?: \*)?$/, { selector: "input" }),
      { target: { value: "4569J5771" } },
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

    form!.reset();
    view.rerender(<LegacyApiRegistryForm bots={[]} />);

    const resetFormData = new FormData(form!);
    expect(resetFormData.get("apiKeyHeaderName")).toBe("x-api-key");
    expect(resetFormData.get("apiKey")).toBe("test-secret");
    expect(form!.checkValidity()).toBe(true);
  });
});
