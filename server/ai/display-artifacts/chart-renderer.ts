import type { ChatChartDataset, ChatChartType } from "@/types/chat-artifact";

export type ChartSpec = {
  type: ChatChartType;
  labels: string[];
  datasets: ChatChartDataset[];
  title?: string;
  horizontal?: boolean;
  stacked?: boolean;
  valueSuffix?: string;
};

const WIDTH = 640;
const HEIGHT = 360;
const COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
];
const FONT = "system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";

function color(index: number) {
  return COLORS[index % COLORS.length];
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatNumber(value: number) {
  const absolute = Math.abs(value);
  const maximumFractionDigits =
    absolute >= 100 || Number.isInteger(value) ? 0 : absolute >= 1 ? 1 : 2;
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits }).format(
    value,
  );
}

function text(
  value: string,
  x: number,
  y: number,
  options: {
    anchor?: "start" | "middle" | "end";
    size?: number;
    weight?: number;
    opacity?: number;
  } = {},
) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${options.anchor ?? "middle"}" font-family="${FONT}" font-size="${options.size ?? 12}" font-weight="${options.weight ?? 400}" fill="currentColor" fill-opacity="${options.opacity ?? 0.72}">${escapeXml(value)}</text>`;
}

function wrap(body: string, title?: string) {
  const heading = title
    ? text(title, WIDTH / 2, 23, { size: 15, weight: 600, opacity: 0.9 })
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"${title ? ` aria-label="${escapeXml(title)}"` : ""}><rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>${heading}${body}</svg>`;
}

function niceScale(values: number[]) {
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const rough = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const scaleMin = Math.floor(minimum / step) * step;
  const scaleMax = Math.ceil(maximum / step) * step || step;
  const ticks: number[] = [];
  for (let value = scaleMin; value <= scaleMax + step / 2; value += step)
    ticks.push(Math.round(value / step) * step);
  return { scaleMin, scaleMax, ticks };
}

function legend(spec: ChartSpec) {
  if (spec.datasets.length < 2) return "";
  const width = WIDTH / spec.datasets.length;
  return spec.datasets
    .map((dataset, index) => {
      const x = width * index + width / 2;
      return (
        `<rect x="${(x - 58).toFixed(1)}" y="340" width="10" height="10" rx="2" fill="${color(index)}"/>` +
        text(truncate(dataset.label || `ชุดข้อมูล ${index + 1}`, 18), x, 349, {
          size: 11,
          opacity: 0.78,
        })
      );
    })
    .join("");
}

function renderAxisChart(spec: ChartSpec) {
  const horizontal = spec.type === "bar" && spec.horizontal;
  const stacked = spec.type === "bar" && spec.stacked;
  const top = spec.title ? 42 : 18;
  const bottom = spec.datasets.length > 1 ? 62 : 43;
  const left = horizontal ? 126 : 60;
  const right = 24;
  const plotWidth = WIDTH - left - right;
  const plotHeight = HEIGHT - top - bottom;
  const values = stacked
    ? spec.labels.flatMap((_, index) => [
        spec.datasets.reduce(
          (sum, dataset) =>
            sum + (dataset.data[index] > 0 ? dataset.data[index] : 0),
          0,
        ),
        spec.datasets.reduce(
          (sum, dataset) =>
            sum + (dataset.data[index] < 0 ? dataset.data[index] : 0),
          0,
        ),
      ])
    : spec.datasets.flatMap((dataset) => dataset.data);
  const { scaleMin, scaleMax, ticks } = niceScale(values);
  const span = scaleMax - scaleMin || 1;
  const parts: string[] = [];

  for (const tick of ticks) {
    const ratio = (tick - scaleMin) / span;
    if (horizontal) {
      const x = left + plotWidth * ratio;
      parts.push(
        `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}" stroke="currentColor" stroke-opacity="0.12"/>`,
        text(formatNumber(tick), x, top + plotHeight + 18, { size: 10 }),
      );
    } else {
      const y = top + plotHeight * (1 - ratio);
      parts.push(
        `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="currentColor" stroke-opacity="0.12"/>`,
        text(formatNumber(tick), left - 8, y + 4, {
          anchor: "end",
          size: 10,
        }),
      );
    }
  }

  const band = (horizontal ? plotHeight : plotWidth) / spec.labels.length;
  spec.labels.forEach((label, index) => {
    const center = (horizontal ? top : left) + band * index + band / 2;
    parts.push(
      horizontal
        ? text(truncate(label, 18), left - 10, center + 4, {
            anchor: "end",
            size: 10,
          })
        : text(
            truncate(label, spec.labels.length > 12 ? 7 : 14),
            center,
            top + plotHeight + 18,
            { size: 10 },
          ),
    );
  });

  if (spec.type === "line") {
    spec.datasets.forEach((dataset, datasetIndex) => {
      const points = dataset.data.map((value, index) => ({
        x: left + band * index + band / 2,
        y: top + plotHeight * (1 - (value - scaleMin) / span),
      }));
      parts.push(
        `<polyline fill="none" stroke="${color(datasetIndex)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`,
      );
      points.forEach(({ x, y }, index) =>
        parts.push(
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color(datasetIndex)}"><title>${escapeXml(`${spec.labels[index]}: ${formatNumber(dataset.data[index])}${spec.valueSuffix ?? ""}`)}</title></circle>`,
        ),
      );
    });
  } else {
    const groupSize = band * 0.68;
    const barSize = stacked ? groupSize : groupSize / spec.datasets.length;
    spec.labels.forEach((label, labelIndex) => {
      let positiveBase = 0;
      let negativeBase = 0;
      spec.datasets.forEach((dataset, datasetIndex) => {
        const value = dataset.data[labelIndex];
        const base = stacked ? (value >= 0 ? positiveBase : negativeBase) : 0;
        if (stacked) {
          if (value >= 0) positiveBase += value;
          else negativeBase += value;
        }
        const from = (base - scaleMin) / span;
        const to = (base + value - scaleMin) / span;
        const offset =
          (horizontal ? top : left) +
          band * labelIndex +
          (band - groupSize) / 2 +
          (stacked ? 0 : barSize * datasetIndex);
        const title = escapeXml(
          `${label}${dataset.label ? ` — ${dataset.label}` : ""}: ${formatNumber(value)}${spec.valueSuffix ?? ""}`,
        );
        if (horizontal) {
          const x1 = left + plotWidth * Math.min(from, to);
          const x2 = left + plotWidth * Math.max(from, to);
          parts.push(
            `<rect x="${x1.toFixed(1)}" y="${offset.toFixed(1)}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="${Math.max(2, barSize - 3).toFixed(1)}" rx="3" fill="${color(datasetIndex)}"><title>${title}</title></rect>`,
          );
        } else {
          const y1 = top + plotHeight * (1 - Math.max(from, to));
          const y2 = top + plotHeight * (1 - Math.min(from, to));
          parts.push(
            `<rect x="${offset.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(2, barSize - 3).toFixed(1)}" height="${Math.max(1, y2 - y1).toFixed(1)}" rx="3" fill="${color(datasetIndex)}"><title>${title}</title></rect>`,
          );
        }
      });
    });
  }

  if (spec.valueSuffix)
    parts.push(
      text(spec.valueSuffix.trim(), left, top - 6, {
        anchor: "start",
        size: 10,
        opacity: 0.6,
      }),
    );
  parts.push(legend(spec));
  return wrap(parts.join(""), spec.title);
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function renderPieChart(spec: ChartSpec) {
  const values = spec.datasets[0].data;
  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = 210;
  const cy = spec.title ? 190 : 178;
  const radius = 118;
  const inner = spec.type === "doughnut" ? radius * 0.56 : 0;
  const parts: string[] = [];
  let angle = -Math.PI / 2;

  values.forEach((value, index) => {
    if (value <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    const end = angle + sweep;
    const title = escapeXml(
      `${spec.labels[index]}: ${formatNumber(value)}${spec.valueSuffix ?? ""} (${formatNumber((value / total) * 100)}%)`,
    );
    if (sweep >= Math.PI * 2 - 1e-6) {
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color(index)}"><title>${title}</title></circle>`,
      );
    } else {
      const outerStart = polar(cx, cy, radius, angle);
      const outerEnd = polar(cx, cy, radius, end);
      const large = sweep > Math.PI ? 1 : 0;
      if (inner) {
        const innerEnd = polar(cx, cy, inner, end);
        const innerStart = polar(cx, cy, inner, angle);
        parts.push(
          `<path d="M${outerStart.x},${outerStart.y} A${radius},${radius} 0 ${large} 1 ${outerEnd.x},${outerEnd.y} L${innerEnd.x},${innerEnd.y} A${inner},${inner} 0 ${large} 0 ${innerStart.x},${innerStart.y} Z" fill="${color(index)}"><title>${title}</title></path>`,
        );
      } else {
        parts.push(
          `<path d="M${cx},${cy} L${outerStart.x},${outerStart.y} A${radius},${radius} 0 ${large} 1 ${outerEnd.x},${outerEnd.y} Z" fill="${color(index)}"><title>${title}</title></path>`,
        );
      }
    }
    angle = end;
  });
  if (inner)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${inner - 1}" fill="white"/>`);
  spec.labels.forEach((label, index) => {
    const y = 90 + index * 28;
    if (y > 330) return;
    parts.push(
      `<rect x="370" y="${y - 11}" width="12" height="12" rx="2" fill="${color(index)}"/>`,
      text(
        `${truncate(label, 16)} ${formatNumber(values[index])}${spec.valueSuffix ?? ""}`,
        392,
        y,
        { anchor: "start", size: 11, opacity: 0.8 },
      ),
    );
  });
  return wrap(parts.join(""), spec.title);
}

export function renderChartSvg(spec: ChartSpec) {
  if (spec.type === "pie" || spec.type === "doughnut")
    return renderPieChart(spec);
  return renderAxisChart(spec);
}
