import { expect, test } from "@playwright/test";

const configured = Boolean(
  process.env.PHASE7_E2E_BOT_ID &&
  process.env.PHASE7_E2E_USER &&
  process.env.PHASE7_E2E_PASSWORD,
);

test.describe("Phase 7 permission-aware memory and insight", () => {
  test.skip(
    !configured,
    "Requires a user with insight/chat-audit permissions, an assigned bot, and a configured AI provider.",
  );

  test("create conversations → snapshot → audited drill-down", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email or username")
      .fill(process.env.PHASE7_E2E_USER!);
    await page.getByLabel("Password").fill(process.env.PHASE7_E2E_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    const questions = [
      "How do I reset payroll access?",
      "How do I reset payroll access?",
      "What is the payroll approval policy?",
    ];
    for (const question of questions) {
      await page.goto(`/workspace/chat/${process.env.PHASE7_E2E_BOT_ID}`);
      await page
        .getByPlaceholder("Ask from your permitted knowledge…")
        .fill(question);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(
        page.getByRole("button", { name: "Helpful answer" }),
      ).toBeVisible({
        timeout: 30_000,
      });
    }

    await page.goto("/workspace/insights");
    await page.getByRole("button", { name: "Run business insight" }).click();
    await expect(
      page.getByText(/Evidence sample: \d+ conversations/),
    ).toBeVisible();
    await expect(page.getByText("Top topics")).toBeVisible();

    await page.getByRole("link", { name: "Audited chat history" }).click();
    await page
      .getByLabel("Access reason")
      .fill("Phase 7 automated permission-aware quality review");
    await page
      .getByRole("button", { name: "Record reason and continue" })
      .click();
    await expect(page.getByText(/reason recorded/i)).toBeVisible();
  });
});
