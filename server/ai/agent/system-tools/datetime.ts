import { z } from "zod";
import { defineAgentTool, toolSuccess } from "@/server/ai/agent/types";

export const DEFAULT_TIMEZONE = "Asia/Bangkok";

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parts(timeZone: string, now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  });
  const found = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    date: `${found.year}-${found.month}-${found.day}`,
    time: `${found.hour}:${found.minute}`,
    weekday: found.weekday,
    year: Number(found.year),
  };
}

export function currentDateFacts(timeZone: string, now = new Date()) {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const value = parts(zone, now);
  return {
    iso: now.toISOString(),
    date: value.date,
    time: value.time,
    datetime: `${value.date} ${value.time}`,
    dayOfWeek: value.weekday,
    dayOfWeekTh: new Intl.DateTimeFormat("th-TH", {
      timeZone: zone,
      weekday: "long",
    }).format(now),
    timezone: zone,
    buddhistYear: value.year + 543,
  };
}

/**
 * Kept alongside the date injected into the system prompt on purpose: the
 * prompt value is resolved once when the turn starts and goes stale in a long
 * conversation, while this answers with the time of the call.
 */
export const getCurrentDatetime = defineAgentTool({
  name: "get_current_datetime",
  kind: "SYSTEM",
  access: "READ",
  group: "PLATFORM",
  description:
    "อ่านวันและเวลาปัจจุบัน เรียกก่อนตอบทุกอย่างที่ขึ้นกับคำว่า 'ตอนนี้' เช่น วันนี้ พรุ่งนี้ เมื่อวาน สัปดาห์นี้ เดือนนี้ ไตรมาสนี้ อายุ จำนวนวันจนถึงกำหนด หรือของหมดอายุหรือยัง " +
    "ห้ามเดาวันที่ปัจจุบันจากความจำของตัวเอง " +
    `ตอบตามเขตเวลาของระบบ (${DEFAULT_TIMEZONE}) เว้นแต่ระบุเขตเวลาอื่น`,
  parameters: z.object({
    timezone: z
      .string()
      .max(64)
      .optional()
      .describe('เขตเวลาแบบ IANA เช่น "Asia/Tokyo" ไม่ระบุ = ใช้เขตเวลาของระบบ'),
  }),
  async execute(context, args) {
    const requested = args.timezone;
    // An unknown zone is reported rather than silently swapped, so the model
    // can tell the user which zone the answer is actually in.
    const unknownZone = Boolean(requested && !isValidTimeZone(requested));
    const facts = currentDateFacts(
      unknownZone || !requested ? context.timezone : requested,
    );
    return toolSuccess(
      JSON.stringify(
        unknownZone
          ? {
              ...facts,
              note: `ไม่รู้จักเขตเวลา "${requested}" จึงตอบตามเขตเวลา ${facts.timezone}`,
            }
          : facts,
      ),
    );
  },
});
