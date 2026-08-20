import { expect, test } from "@playwright/test";

const configured = Boolean(
  process.env.PHASE6_E2E_BOT_ID &&
  process.env.PHASE6_E2E_USER &&
  process.env.PHASE6_E2E_PASSWORD &&
  process.env.PHASE6_E2E_INCOMPLETE_QUESTION &&
  process.env.PHASE6_E2E_COMPLETE_QUESTION,
);

test.describe("Phase 6 governed Legacy API Q&A", () => {
  test.skip(
    !configured,
    "Requires an allowlisted public read-only API fixture, assigned bot, ACL, and AI provider.",
  );

  test("clarification → bounded invocation → API/time citation", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email or username")
      .fill(process.env.PHASE6_E2E_USER!);
    await page.getByLabel("Password").fill(process.env.PHASE6_E2E_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.goto(`/workspace/chat/${process.env.PHASE6_E2E_BOT_ID}`);

    const composer = page.getByPlaceholder(/ask|message|question/i);
    await composer.fill(process.env.PHASE6_E2E_INCOMPLETE_QUESTION!);
    await page.getByRole("button", { name: /send/i }).click();
    await expect(
      page.getByText(/provide|required|ระบุ|กรุณา/i).last(),
    ).toBeVisible();

    await composer.fill(process.env.PHASE6_E2E_COMPLETE_QUESTION!);
    await page.getByRole("button", { name: /send/i }).click();
    await expect(page.getByText("Sources").last()).toBeVisible();
    await page.locator("details").last().locator("summary").click();
    await expect(page.getByText(/GET|POST/).last()).toBeVisible();
    await expect(page.getByText(/HTTP \d{3}/).last()).toBeVisible();
  });
});
