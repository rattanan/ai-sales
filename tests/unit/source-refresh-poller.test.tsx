// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { SourceRefreshPoller } from "@/components/sources/source-refresh-poller";

describe("SourceRefreshPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refreshes while source ingestion is active and stops afterward", () => {
    const view = render(<SourceRefreshPoller active />);

    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    view.rerender(<SourceRefreshPoller active={false} />);
    vi.advanceTimersByTime(4_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
