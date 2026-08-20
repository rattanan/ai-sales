import { db } from "@/server/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const bot = await db.bot.findFirst({
    where: { id: botId, active: true },
    select: {
      primaryColor: true,
      launcherIcon: true,
      widgetSize: true,
      launcherSize: true,
      windowPosition: true,
    },
  });
  if (!bot) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  return Response.json(
    {
      primaryColor: bot.primaryColor,
      launcherIcon: bot.launcherIcon,
      widgetSize: bot.widgetSize,
      launcherSize: bot.launcherSize,
      windowPosition: bot.windowPosition,
    },
    {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
