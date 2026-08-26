"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import {
  BarChart3,
  Download,
  Expand,
  ImageIcon,
  QrCode,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import type { ChatArtifact, ChatChartArtifact } from "@/types/chat-artifact";

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function artifactPresentation(artifact: ChatArtifact) {
  if (artifact.kind === "qr")
    return {
      title: artifact.label || "QR code",
      caption: artifact.caption,
      alt: artifact.label || "QR code",
      src: svgDataUrl(artifact.svg),
      downloadName: `qr-${artifact.id}.svg`,
      icon: QrCode,
      width: 320,
      height: 320,
    };
  if (artifact.kind === "chart")
    return {
      title: artifact.title || "Chart",
      caption: undefined,
      alt: artifact.title || "Chart",
      src: svgDataUrl(artifact.svg),
      downloadName: `chart-${artifact.id}.svg`,
      icon: BarChart3,
      width: 640,
      height: 360,
    };
  const extension = artifact.mediaType.split("/")[1];
  return {
    title: artifact.caption || "Image",
    caption: artifact.caption,
    alt: artifact.alt,
    src: artifact.src,
    downloadName: `image-${artifact.id}.${extension}`,
    icon: ImageIcon,
    width: 1_200,
    height: 800,
  };
}

function ChartDataTable({ artifact }: { artifact: ChatChartArtifact }) {
  const { locale, t } = useWorkspaceLocale();
  const numberFormat = new Intl.NumberFormat(locale === "th" ? "th-TH" : "en");
  return (
    <details className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
      <summary className="min-h-7 cursor-pointer py-1 text-xs font-semibold text-muted-foreground">
        {t("Chart data")}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-80 border-collapse text-left text-xs">
          <thead>
            <tr>
              <th scope="col" className="border-b px-2 py-2 font-semibold">
                {t("Category")}
              </th>
              {artifact.datasets.map((dataset, index) => (
                <th
                  key={`${dataset.label ?? "dataset"}-${index}`}
                  scope="col"
                  className="border-b px-2 py-2 text-right font-semibold"
                >
                  {dataset.label || `${t("Series")} ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.labels.map((label, rowIndex) => (
              <tr key={`${label}-${rowIndex}`}>
                <th scope="row" className="border-b px-2 py-2 font-medium">
                  {label}
                </th>
                {artifact.datasets.map((dataset, datasetIndex) => (
                  <td
                    key={`${datasetIndex}-${rowIndex}`}
                    className="border-b px-2 py-2 text-right tabular-nums"
                  >
                    {numberFormat.format(dataset.data[rowIndex])}
                    {artifact.valueSuffix}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ArtifactImage({
  artifact,
  expanded = false,
}: {
  artifact: ChatArtifact;
  expanded?: boolean;
}) {
  const presentation = artifactPresentation(artifact);
  return (
    <div
      className={
        artifact.kind === "qr"
          ? "mx-auto grid max-w-80 place-items-center rounded-xl bg-white p-4"
          : expanded
            ? "grid min-h-0 flex-1 place-items-center overflow-auto rounded-xl bg-muted/30 p-3"
            : "overflow-hidden rounded-xl bg-muted/30"
      }
    >
      <Image
        src={presentation.src}
        alt={presentation.alt}
        width={presentation.width}
        height={presentation.height}
        unoptimized
        referrerPolicy="no-referrer"
        className={
          artifact.kind === "qr"
            ? "h-auto w-full max-w-64"
            : expanded
              ? "h-auto max-h-[72dvh] w-auto max-w-full object-contain"
              : "h-auto max-h-[28rem] w-full object-contain"
        }
      />
    </div>
  );
}

function ChatArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  const { t } = useWorkspaceLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const presentation = artifactPresentation(artifact);
  const Icon = presentation.icon;

  function openDialog() {
    openerRef.current = document.activeElement as HTMLElement | null;
    setDialogOpen(true);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t(presentation.title)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${t("Open full size")}: ${t(presentation.title)}`}
          title={t("Open full size")}
          onClick={openDialog}
          className="size-11 shrink-0"
        >
          <Expand className="size-4" aria-hidden="true" />
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
        >
          <a
            href={presentation.src}
            download={presentation.downloadName}
            aria-label={`${t("Download")}: ${t(presentation.title)}`}
            title={t("Download")}
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
        </Button>
      </div>
      <div className="p-3">
        <ArtifactImage artifact={artifact} />
        {presentation.caption ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {presentation.caption}
          </p>
        ) : null}
        {artifact.kind === "chart" ? (
          <ChartDataTable artifact={artifact} />
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-label={`${t("Full-size preview")}: ${t(presentation.title)}`}
        onClose={() => {
          setDialogOpen(false);
          openerRef.current?.focus();
        }}
        className="m-auto h-[min(90dvh,900px)] w-[min(94vw,1100px)] max-w-none rounded-2xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/65"
      >
        <div className="flex h-full min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
              {t(presentation.title)}
            </h2>
            <Button asChild variant="outline" size="icon">
              <a
                href={presentation.src}
                download={presentation.downloadName}
                aria-label={`${t("Download")}: ${t(presentation.title)}`}
                title={t("Download")}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("Close")}
              title={t("Close")}
              onClick={closeDialog}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {dialogOpen ? <ArtifactImage artifact={artifact} expanded /> : null}
        </div>
      </dialog>
    </section>
  );
}

export function ChatArtifactList({
  artifacts,
}: {
  artifacts?: ChatArtifact[];
}) {
  const { t } = useWorkspaceLocale();
  if (!artifacts?.length) return null;
  return (
    <div
      role="group"
      className="mt-3 grid gap-3"
      aria-label={t("Generated visual content")}
    >
      {artifacts.map((artifact) => (
        <ChatArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}
