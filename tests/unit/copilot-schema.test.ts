import { describe, expect, it } from "vitest";
import { copilotPromptSchema } from "@/schemas/copilot";

describe("copilot prompt schema", () => {
  it("accepts a bounded dashboard prompt and optional current context", () => {
    const parsed = copilotPromptSchema.safeParse({
      dashboardId: "cmrq85aey025hin17oq44zo4k",
      selectedWidgetId: "cmrr2tes0006ios17tfjf9eze",
      prompt: "Compare this month with last month",
      filters: { warehouse: ["Bangkok"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty prompt and untrusted dashboard identifier", () => {
    expect(
      copilotPromptSchema.safeParse({ dashboardId: "other", prompt: "" })
        .success,
    ).toBe(false);
  });
});
