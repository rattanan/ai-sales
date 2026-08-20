type FormattedApiAnswer = {
  summary: string;
  limitations: string[];
};

const DISPLAY_ROW_LIMIT = 10;
const DISPLAY_COLUMN_LIMIT = 8;
const DISPLAY_FIELD_LIMIT = 16;

function isThai(value: string) {
  return /[ก-๙]/u.test(value);
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayValue(value: unknown, thai: boolean) {
  if (value == null || value === "") return "–";
  if (typeof value === "number" && Number.isFinite(value))
    return new Intl.NumberFormat(thai ? "th-TH" : "en-US", {
      maximumFractionDigits: 6,
    }).format(value);
  if (typeof value === "boolean")
    return thai ? (value ? "ใช่" : "ไม่ใช่") : value ? "Yes" : "No";
  return String(value)
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function flattenObject(
  value: unknown,
  prefix = "",
  result: Array<[string, unknown]> = [],
) {
  if (result.length >= DISPLAY_FIELD_LIMIT) return result;
  if (Array.isArray(value)) {
    if (value.every((item) => item == null || typeof item !== "object")) {
      result.push([prefix || "Value", value.map(String).join(", ")]);
    } else if (value.length) {
      flattenObject(value[0], prefix, result);
    }
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (result.length >= DISPLAY_FIELD_LIMIT) break;
      flattenObject(nested, prefix ? `${prefix} ${key}` : key, result);
    }
    return result;
  }
  result.push([prefix || "Value", value]);
  return result;
}

function flatTableRow(value: Record<string, unknown>) {
  return Object.fromEntries(
    flattenObject(value).slice(0, DISPLAY_COLUMN_LIMIT),
  );
}

function formatWeatherAnswer(
  thai: boolean,
  title: string,
  payload: Record<string, unknown>,
): FormattedApiAnswer | null {
  const main =
    payload.main && typeof payload.main === "object"
      ? (payload.main as Record<string, unknown>)
      : null;
  const weather = Array.isArray(payload.weather)
    ? (payload.weather[0] as Record<string, unknown> | undefined)
    : null;
  if (!main || !("temp" in main) || !weather) return null;

  const wind =
    payload.wind && typeof payload.wind === "object"
      ? (payload.wind as Record<string, unknown>)
      : null;
  const clouds =
    payload.clouds && typeof payload.clouds === "object"
      ? (payload.clouds as Record<string, unknown>)
      : null;
  const sys =
    payload.sys && typeof payload.sys === "object"
      ? (payload.sys as Record<string, unknown>)
      : null;
  const fields: Array<[string, unknown]> = [
    [thai ? "สถานที่" : "Location", payload.name],
    [thai ? "สภาพอากาศ" : "Weather", weather.description ?? weather.main],
    [thai ? "อุณหภูมิ" : "Temperature", main.temp],
    [thai ? "รู้สึกเหมือน" : "Feels Like", main.feels_like],
    [thai ? "ความชื้น" : "Humidity", main.humidity],
    [thai ? "ความกดอากาศ" : "Pressure", main.pressure],
    [thai ? "ความเร็วลม" : "Wind Speed", wind?.speed],
    [thai ? "ปริมาณเมฆ" : "Cloudiness", clouds?.all],
    [thai ? "ประเทศ" : "Country", sys?.country],
  ].filter((entry) => entry[1] != null) as Array<[string, unknown]>;

  return {
    summary: [
      title,
      "",
      ...fields.map(
        ([label, value]) => `- ${label}: ${displayValue(value, thai)}`,
      ),
    ].join("\n"),
    limitations: [],
  };
}

export function formatApiAnswer(
  question: string,
  apiName: string,
  payload: unknown,
): FormattedApiAnswer {
  const thai = isThai(question);
  const title = thai ? `ข้อมูลจาก ${apiName}` : `Result from ${apiName}`;

  if (payload == null)
    return {
      summary: thai ? `${title}: ไม่พบข้อมูล` : `${title}: No data returned.`,
      limitations: [],
    };

  if (typeof payload !== "object")
    return {
      summary: `${title}: ${displayValue(payload, thai)}`,
      limitations: [],
    };

  if (!Array.isArray(payload)) {
    const weather = formatWeatherAnswer(
      thai,
      title,
      payload as Record<string, unknown>,
    );
    if (weather) return weather;
  }

  if (Array.isArray(payload)) {
    if (!payload.length)
      return {
        summary: thai ? `${title}: ไม่พบข้อมูล` : `${title}: No data returned.`,
        limitations: [],
      };
    if (payload.every((item) => item == null || typeof item !== "object"))
      return {
        summary: [
          title,
          "",
          ...payload
            .slice(0, DISPLAY_ROW_LIMIT)
            .map((item) => `- ${displayValue(item, thai)}`),
        ].join("\n"),
        limitations:
          payload.length > DISPLAY_ROW_LIMIT
            ? [
                thai
                  ? `แสดง ${DISPLAY_ROW_LIMIT} จากทั้งหมด ${payload.length} รายการ`
                  : `Showing ${DISPLAY_ROW_LIMIT} of ${payload.length} items.`,
              ]
            : [],
      };

    const displayRows = payload
      .slice(0, DISPLAY_ROW_LIMIT)
      .map((item) => flatTableRow(item as Record<string, unknown>));
    const columns = Array.from(
      new Set(displayRows.flatMap((row) => Object.keys(row))),
    ).slice(0, DISPLAY_COLUMN_LIMIT);
    const header = `| ${columns.map(humanize).join(" | ")} |`;
    const separator = `| ${columns.map(() => "---").join(" | ")} |`;
    const rows = displayRows.map(
      (row) =>
        `| ${columns.map((column) => displayValue(row[column], thai)).join(" | ")} |`,
    );
    return {
      summary: [title, "", header, separator, ...rows].join("\n"),
      limitations:
        payload.length > displayRows.length
          ? [
              thai
                ? `แสดง ${displayRows.length} จากทั้งหมด ${payload.length} รายการ`
                : `Showing ${displayRows.length} of ${payload.length} items.`,
            ]
          : [],
    };
  }

  const fields = flattenObject(payload);
  const details = fields.map(
    ([label, value]) => `- ${humanize(label)}: ${displayValue(value, thai)}`,
  );
  return {
    summary: [title, "", ...details].join("\n"),
    limitations:
      Object.keys(payload).length > fields.length
        ? [
            thai
              ? "แสดงเฉพาะข้อมูลสำคัญบางส่วนจากผลลัพธ์ API"
              : "Showing selected fields from the API response.",
          ]
        : [],
  };
}
