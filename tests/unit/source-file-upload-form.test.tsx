// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceFileUploadForm } from "@/components/sources/source-file-upload-form";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("SourceFileUploadForm", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ queued: true, duplicate: false }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uploads a file to an existing source and refreshes its metrics", async () => {
    render(<SourceFileUploadForm sourceId="source-1" />);
    const file = new File(["knowledge"], "knowledge.txt", {
      type: "text/plain",
    });
    fireEvent.change(screen.getByLabelText("Choose a document"), {
      target: { files: [file] },
    });
    const submit = screen.getByRole("button", {
      name: "Upload file / new version",
    });
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/knowledge-sources/source-1/documents");
    expect(request).toMatchObject({ method: "POST" });
    expect((request?.body as FormData).get("file")).toBe(file);
    await waitFor(() =>
      expect(
        screen.getByText("File uploaded. Indexing has been queued."),
      ).toBeTruthy(),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
