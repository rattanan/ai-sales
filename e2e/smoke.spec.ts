import { expect, test } from "@playwright/test";

test("public product and administrator-managed registration policy render", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Turn trusted knowledge/ }),
  ).toBeVisible();
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Registration is disabled" }),
  ).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveCount(0);
});

test("login exposes enterprise recovery and generic validation", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email or username")).toBeVisible();
  await expect(page.getByLabel("Remember me")).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await page.getByLabel("Registered email").fill("unknown@example.test");
  await page.getByRole("button", { name: "Send reset instructions" }).click();
  await expect(page.getByText("Request completed successfully.")).toBeVisible();
});
