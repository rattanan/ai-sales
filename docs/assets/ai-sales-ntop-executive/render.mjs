import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(join(directory, "render.html")).href;
const montageUrl = pathToFileURL(join(directory, "montage.html")).href;
const names = [
  "00-cover.png",
  "01-problem.png",
  "02-one-experience.png",
  "03-grounded-answer.png",
  "04-human-confirmation.png",
  "05-sales-benefits.png",
  "06-executive-benefits.png",
  "07-trust-control.png",
  "08-pilot.png",
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

for (let index = 0; index < names.length; index += 1) {
  await page.goto(`${pageUrl}?s=${index}`, { waitUntil: "load" });
  await page.screenshot({ path: join(directory, names[index]), type: "png" });
}

await page.setViewportSize({ width: 1920, height: 1120 });
await page.goto(montageUrl, { waitUntil: "load" });
await page.screenshot({ path: join(directory, "montage.png"), type: "png" });

await browser.close();
