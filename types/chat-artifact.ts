export type ChatChartType = "bar" | "line" | "pie" | "doughnut";

export type ChatChartDataset = {
  label?: string;
  data: number[];
};

export type ChatQrArtifact = {
  id: string;
  kind: "qr";
  svg: string;
  label?: string;
  caption?: string;
};

export type ChatChartArtifact = {
  id: string;
  kind: "chart";
  svg: string;
  type: ChatChartType;
  labels: string[];
  datasets: ChatChartDataset[];
  title?: string;
  horizontal?: boolean;
  stacked?: boolean;
  valueSuffix?: string;
};

export type ChatImageArtifact = {
  id: string;
  kind: "image";
  src: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  alt: string;
  caption?: string;
};

/**
 * The single Interface every chat surface receives. Unknown future kinds are
 * filtered at the server mapper, so older clients remain forward compatible.
 */
export type ChatArtifact =
  ChatQrArtifact | ChatChartArtifact | ChatImageArtifact;
