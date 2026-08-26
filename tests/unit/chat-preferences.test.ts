// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  isThinkLevel,
  rememberThinkLevel,
  THINK_LEVEL_COOKIE,
} from "@/lib/chat-preferences";

describe("think level preference", () => {
  afterEach(() => {
    document.cookie = `${THINK_LEVEL_COOKIE}=; Path=/; Max-Age=0`;
  });

  it("accepts every level the composer offers", () => {
    expect(["DEFAULT", "low", "medium", "high"].every(isThinkLevel)).toBe(true);
  });

  it("rejects anything else, so a tampered cookie falls back", () => {
    expect(isThinkLevel("HIGH")).toBe(false);
    expect(isThinkLevel("extreme")).toBe(false);
    expect(isThinkLevel(undefined)).toBe(false);
    expect(isThinkLevel(3)).toBe(false);
  });

  it("writes a cookie the server component can read on the next render", () => {
    rememberThinkLevel("high");

    expect(document.cookie).toContain(`${THINK_LEVEL_COOKIE}=high`);
  });

  it("replaces the previous choice rather than stacking cookies", () => {
    rememberThinkLevel("low");
    rememberThinkLevel("medium");

    const written = document.cookie
      .split("; ")
      .filter((pair) => pair.startsWith(`${THINK_LEVEL_COOKIE}=`));
    expect(written).toEqual([`${THINK_LEVEL_COOKIE}=medium`]);
  });
});
