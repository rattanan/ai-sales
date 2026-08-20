import { describe, expect, it } from "vitest";
import { deleteKnowledgeResourceSchema } from "@/schemas/knowledge-deletion";

describe("knowledge deletion confirmation", () => {
  it("accepts a resource ID and trims the confirmation name", () => {
    expect(
      deleteKnowledgeResourceSchema.parse({
        id: "source-1",
        confirmationName: "  Policies  ",
      }),
    ).toEqual({ id: "source-1", confirmationName: "Policies" });
  });

  it.each([
    { id: "", confirmationName: "Policies" },
    { id: "source-1", confirmationName: "   " },
  ])("rejects incomplete confirmation input", (input) => {
    expect(deleteKnowledgeResourceSchema.safeParse(input).success).toBe(false);
  });
});
