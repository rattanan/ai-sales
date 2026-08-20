// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let actionState: unknown = null;
const refresh = vi.fn();

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: () => [actionState, vi.fn(), false],
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/features/knowledge/add-knowledge-action", () => ({
  addKnowledgeAction: vi.fn(),
}));

import { AddKnowledgeWizard } from "@/components/sources/add-knowledge-wizard";

describe("AddKnowledgeWizard file upload", () => {
  beforeEach(() => {
    actionState = null;
    refresh.mockReset();
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("retains the selected file after the form action resets the file input", async () => {
    const view = render(
      <AddKnowledgeWizard
        folders={[{ id: "rack-1", name: "General" }]}
        bots={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Knowledge" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.change(screen.getByLabelText(/knowledge name/i), {
      target: { value: "Employee handbook" },
    });
    const selectedFile = new File(["handbook"], "handbook.txt", {
      type: "text/plain",
    });
    const fileInput = screen.getByLabelText(/^file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [selectedFile] } });

    // React resets an uncontrolled form after its action succeeds.
    fileInput.form?.reset();
    actionState = {
      ok: true,
      data: { id: "source-1", uploadRequired: true },
    };
    view.rerender(
      <AddKnowledgeWizard
        folders={[{ id: "rack-1", name: "General" }]}
        bots={[]}
      />,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/knowledge-sources/source-1/documents");
    expect(request).toMatchObject({ method: "POST" });
    expect((request?.body as FormData).get("file")).toBe(selectedFile);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the response status and retries the upload without recreating the source", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          {
            message:
              "File storage is unavailable. Check System Health and retry the upload.",
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const view = render(
      <AddKnowledgeWizard
        folders={[{ id: "rack-1", name: "General" }]}
        bots={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Knowledge" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/knowledge name/i), {
      target: { value: "Meeting report" },
    });
    const selectedFile = new File(["%PDF-1.7"], "meeting.pdf", {
      type: "application/pdf",
    });
    const fileInput = screen.getByLabelText(/^file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [selectedFile] } });
    // jsdom does not treat a synthetic FileList as satisfying a required
    // file input, even though browsers do.
    fileInput.removeAttribute("required");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fileInput.form?.reset();
    actionState = {
      ok: true,
      data: { id: "source-1", uploadRequired: true },
    };
    view.rerender(
      <AddKnowledgeWizard
        folders={[{ id: "rack-1", name: "General" }]}
        bots={[]}
      />,
    );

    expect(
      await screen.findByText(
        "File storage is unavailable. Check System Health and retry the upload.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/knowledge-sources/source-1/documents",
    );
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
      "/api/knowledge-sources/source-1/documents",
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
