// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useComposerReveal } from "@/components/chat/use-composer-reveal";

/** The hook reads only these three, so a plain object keeps the test honest. */
function log(scrollTop: number, scrollHeight = 2_000, clientHeight = 500) {
  return { scrollTop, scrollHeight, clientHeight } as unknown as HTMLElement;
}

describe("useComposerReveal", () => {
  it("slides the composer away when the reader scrolls forward", () => {
    const { result } = renderHook(() => useComposerReveal(""));

    act(() => result.current.trackScroll(log(400)));

    expect(result.current.composerHidden).toBe(true);
  });

  it("brings it back on the first move upward", () => {
    const { result } = renderHook(() => useComposerReveal(""));

    act(() => result.current.trackScroll(log(400)));
    act(() => result.current.trackScroll(log(300)));

    expect(result.current.composerHidden).toBe(false);
  });

  it("brings it back on arrival at the newest message", () => {
    const { result } = renderHook(() => useComposerReveal(""));

    act(() => result.current.trackScroll(log(400)));
    act(() => result.current.trackScroll(log(1_490)));

    expect(result.current.composerHidden).toBe(false);
  });

  it("ignores jitter below the direction threshold", () => {
    const { result } = renderHook(() => useComposerReveal(""));

    act(() => result.current.trackScroll(log(400)));
    act(() => result.current.trackScroll(log(396)));

    expect(result.current.composerHidden).toBe(true);
  });

  it("pins the composer open while a draft is unsent", () => {
    const { result } = renderHook(() => useComposerReveal("half a question"));

    act(() => result.current.trackScroll(log(400)));

    expect(result.current.composerHidden).toBe(false);
  });

  it("follows a new answer only while the reader is at the bottom", () => {
    const { result } = renderHook(() => useComposerReveal(""));

    const parked = log(1_490);
    act(() => result.current.trackScroll(parked));
    act(() => result.current.followLatest(parked));
    expect(parked.scrollTop).toBe(2_000);

    const readingBack = log(200);
    act(() => result.current.trackScroll(readingBack));
    act(() => result.current.followLatest(readingBack));
    expect(readingBack.scrollTop).toBe(200);
  });
});
