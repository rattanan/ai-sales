import { expect, test } from "@playwright/test";

const configured = Boolean(
  process.env.PHASE5_E2E_DATA_SOURCE_ID &&
  process.env.PHASE5_E2E_USER &&
  process.env.PHASE5_E2E_PASSWORD,
);

test.describe("Phase 5 governed database Q&A", () => {
  test.skip(
    !configured,
    "Requires a connected read-only fixture and configured AI provider.",
  );

  test("question → metadata selection → validation → execution → summary and citation", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("Email or username")
      .fill(process.env.PHASE5_E2E_USER!);
    await page.getByLabel("Password").fill(process.env.PHASE5_E2E_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.goto(
      `/workspace/data-sources/${process.env.PHASE5_E2E_DATA_SOURCE_ID}/query`,
    );
    await expect(page.getByRole("heading", { name: /Ask / })).toBeVisible();
    await page
      .getByLabel(/Ask /)
      .fill(
        process.env.PHASE5_E2E_QUESTION ??
          "How many orders were created in 2026?",
      );
    await page
      .getByRole("button", { name: "Generate read-only query" })
      .click();

    const clarification = page.getByRole("heading", {
      name: "Clarification required",
    });
    const review = page.getByRole("heading", {
      name: "Validated execution plan",
    });
    await expect(clarification.or(review)).toBeVisible();
    if (await clarification.isVisible()) return;

    await page.getByRole("button", { name: "Approve and execute" }).click();
    await expect(
      page.getByRole("heading", { name: "Grounded result" }),
    ).toBeVisible();
    await expect(page.getByText(/rows · .* ms ·/)).toBeVisible();
    await expect(page.getByText(/MYSQL|POSTGRESQL|MSSQL|ORACLE/)).toBeVisible();
  });
});
