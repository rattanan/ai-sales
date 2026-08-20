import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const connectionString = process.env.DATABASE_URL;
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

test.skip(
  !connectionString || !encryptionKey,
  "Database and credential encryption are required",
);

type WidgetFixture = {
  organizationId: string;
  ownerId: string;
  botId: string;
  role: string;
  signingSecret: string;
};

function fixtureCommand(args: string[]) {
  return execFileSync(
    "./node_modules/.bin/tsx",
    ["e2e/widget-fixture.ts", ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

test("signed sample host opens the widget, chats, and reconnects on mobile", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const port = 4174;
  const hostOrigin = `http://127.0.0.1:${port}`;
  let sampleHost: ChildProcess | undefined;
  let fixture: WidgetFixture | undefined;
  try {
    const configured = JSON.parse(
      fixtureCommand(["setup", hostOrigin]),
    ) as WidgetFixture;
    fixture = configured;
    sampleHost = spawn(process.execPath, ["examples/widget-host/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        INSIGHTKM_BASE_URL: baseURL,
        INSIGHTKM_BOT_ID: configured.botId,
        INSIGHTKM_WIDGET_SIGNING_SECRET: configured.signingSecret,
        INSIGHTKM_WIDGET_ROLE: configured.role,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await Promise.race([
      once(sampleHost.stdout!, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Sample host did not start")), 5_000),
      ),
    ]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(hostOrigin);
    await page.getByRole("button", { name: "Open InsightKM chat" }).click();
    const frame = page.frameLocator(`iframe[title="InsightKM secure chat"]`);
    await expect(frame.getByRole("status")).toHaveText("Secure session ready");
    await expect(
      frame.getByText("Welcome to the secure widget."),
    ).toBeVisible();
    await frame.getByLabel("Message").fill("What is the retention policy?");
    await frame.getByRole("button", { name: "Send" }).click();
    await expect(
      frame.getByText(/could not find enough evidence/i),
    ).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Open InsightKM chat" }).click();
    const reconnected = page.frameLocator(
      `iframe[title="InsightKM secure chat"]`,
    );
    await expect(reconnected.getByRole("status")).toHaveText(
      "Secure session ready",
    );
    await expect(
      reconnected.getByText("What is the retention policy?"),
    ).toBeVisible();
    await expect(reconnected.locator("body")).toHaveJSProperty(
      "clientWidth",
      390,
    );
  } finally {
    sampleHost?.kill("SIGTERM");
    if (fixture)
      fixtureCommand(["cleanup", fixture.organizationId, fixture.ownerId]);
  }
});
