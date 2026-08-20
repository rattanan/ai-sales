// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TopicsTrendsView } from "@/components/analytics/topics-trends-view";

afterEach(() => cleanup());

describe("topics and trends presentation", () => {
  it("presents topic evidence as a readable ranked summary instead of JSON", () => {
    const { container } = render(
      <TopicsTrendsView
        topics={[
          { topic: "work order", count: 4 },
          { topic: "asset description", count: 2 },
        ]}
        trends={[]}
        questionCount={8}
        reprocessed={false}
      />,
    );

    expect(screen.getByText("Leading topic")).toBeTruthy();
    expect(screen.getByText("work order")).toBeTruthy();
    expect(screen.getByText("1. work order")).toBeTruthy();
    expect(screen.getByText("4 · 50%")).toBeTruthy();
    expect(container.textContent).not.toContain("messageIds");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("explains when a legacy snapshot was reprocessed", () => {
    render(
      <TopicsTrendsView
        topics={[]}
        trends={[]}
        questionCount={0}
        reprocessed
      />,
    );

    expect(screen.getByText(/legacy snapshot were reprocessed/i)).toBeTruthy();
    expect(screen.getByText(/no daily trend data/i)).toBeTruthy();
  });
});
