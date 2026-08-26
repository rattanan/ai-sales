// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CitationSource,
  CitationSources,
  citationPresentation,
  type ChatCitation,
} from "@/components/chat/citation-sources";

const webCitation: ChatCitation = {
  id: "citation-web",
  rank: 2,
  quote: "Search the world's information, including webpages and images.",
  metadata: {
    sourceType: "WEB_SEARCH",
    title: "Google",
    url: "https://www.google.com/search?q=insightkm",
    fetchedAt: "2026-08-26T08:00:00.000Z",
  },
};

describe("citation sources", () => {
  afterEach(cleanup);

  it("derives safe web and document destinations from citation metadata", () => {
    expect(citationPresentation(webCitation)).toMatchObject({
      href: "https://www.google.com/search?q=insightkm",
      kind: "web",
      label: "google.com",
      title: "Google",
    });

    expect(
      citationPresentation({
        id: "citation-document",
        rank: 3,
        quote: "Policy excerpt",
        metadata: {
          documentId: "document/unsafe path",
          documentName: "Policy.pdf",
          page: 7,
        },
      }),
    ).toMatchObject({
      href: "/api/documents/document%2Funsafe%20path/download#page=7",
      kind: "document",
      label: "Policy.pdf",
    });
  });

  it("does not turn unsafe citation URLs into links", () => {
    expect(
      citationPresentation({
        id: "citation-unsafe",
        rank: 1,
        quote: "Untrusted result",
        metadata: { url: "javascript:alert(1)", title: "Unsafe" },
      }).href,
    ).toBeNull();
  });

  it("opens an accessible preview card from the compact trigger", () => {
    render(<CitationSource citation={webCitation} variant="number" />);

    const trigger = screen.getByRole("button", {
      name: /View source 2: Google/,
    });
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: /Google/ })).toBeTruthy();
    expect(screen.getByText(webCitation.quote)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open source/ }).getAttribute("href"),
    ).toBe("https://www.google.com/search?q=insightkm");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps source names in the hover preview instead of the compact chips", () => {
    render(<CitationSources citations={[webCitation]} />);

    expect(screen.getByRole("list", { name: "Sources" })).toBeTruthy();
    const chip = screen.getByRole("button", {
      name: "View source 2: Google",
    });
    expect(screen.queryByText("google.com")).toBeNull();

    fireEvent.pointerEnter(chip);

    expect(screen.getByText("google.com")).toBeTruthy();
  });

  it("moves keyboard users into the source link and restores trigger focus", () => {
    render(<CitationSource citation={webCitation} variant="number" />);
    const trigger = screen.getByRole("button", { name: /View source 2/ });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /Open source/ }),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
