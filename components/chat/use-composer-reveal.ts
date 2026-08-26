"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Within this much of the end, the reader counts as parked at the newest turn. */
const BOTTOM_SLACK = 48;
/** Trackpad jitter and momentum bounce would otherwise flip the composer. */
const DIRECTION_SLACK = 8;
/** Breathing room under the last line once the composer has slid away. */
const RESTING_PADDING = 16;

/**
 * Floats the composer over the transcript and slides it out of the way while the
 * reader scrolls forward through a long answer. It comes back on the first move
 * upward, and on arrival at the newest message — so it is never missing at the
 * moment someone wants to reply. A draft in progress or focus inside the
 * composer pins it open regardless.
 *
 * Because it floats, the transcript takes its height as bottom padding; without
 * that the last line would sit underneath it.
 */
export function useComposerReveal(draft: string) {
  const composerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastTopRef = useRef(0);
  const [composerHidden, setComposerHidden] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);

  useEffect(() => {
    const box = composerRef.current;
    // Absent in jsdom, and in that case the transcript simply keeps the padding
    // its own classes give it.
    if (!box || typeof ResizeObserver === "undefined") return;
    const measure = () => setComposerHeight(box.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  function trackScroll(log: HTMLElement) {
    const atBottom =
      log.scrollHeight - log.scrollTop - log.clientHeight < BOTTOM_SLACK;
    followingRef.current = atBottom;
    if (atBottom) {
      lastTopRef.current = log.scrollTop;
      setComposerHidden(false);
      return;
    }
    const delta = log.scrollTop - lastTopRef.current;
    if (Math.abs(delta) < DIRECTION_SLACK) return;
    lastTopRef.current = log.scrollTop;
    const pinned =
      draft.trim().length > 0 ||
      composerRef.current?.contains(document.activeElement) === true;
    setComposerHidden(delta > 0 && !pinned);
  }

  /** Keeps a finished answer in view, but never yanks a reader back down. */
  const followLatest = useCallback((log: HTMLElement | null) => {
    if (!log || !followingRef.current) return;
    log.scrollTop = log.scrollHeight;
    lastTopRef.current = log.scrollTop;
  }, []);

  return {
    composerRef,
    composerHidden,
    /** Undefined until measured, so the transcript's own padding still applies. */
    transcriptPadding: composerHeight
      ? composerHidden
        ? RESTING_PADDING
        : composerHeight
      : undefined,
    trackScroll,
    followLatest,
    /** Tabbing or clicking into the composer must not leave it off-screen. */
    revealComposer: () => setComposerHidden(false),
  };
}
