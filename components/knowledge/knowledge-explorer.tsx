"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  HardDrive,
  LibraryBig,
  Search,
  Type,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DeleteKnowledgeDialog } from "@/components/knowledge/delete-knowledge-dialog";
import { cn } from "@/lib/utils";

type ExplorerSource = {
  id: string;
  name: string;
  type: string;
  status: string;
  scope: "GLOBAL" | "SELECTED_BOTS";
  active: boolean;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  updatedAt: string;
  botNames: string[];
  documents: ExplorerDocument[];
};

type ExplorerDocument = {
  id: string;
  name: string;
  mimeType: string;
  status: string;
  chunkCount: number;
  updatedAt: string;
};

type ExplorerItem =
  | {
      kind: "DOCUMENT";
      key: string;
      source: ExplorerSource;
      document: ExplorerDocument;
    }
  | { kind: "SOURCE"; key: string; source: ExplorerSource };

type ExplorerFolder = {
  id: string;
  name: string;
  description: string | null;
  scope: "GLOBAL" | "SELECTED_BOTS";
  botNames: string[];
  documentCount: number;
  sources: ExplorerSource[];
};

function SourceIcon({ type }: { type: string }) {
  if (type === "WEB") return <Globe2 size={18} className="text-sky-600" />;
  if (type === "SHARED_FOLDER")
    return <HardDrive size={18} className="text-violet-600" />;
  if (type === "COPIED_TEXT")
    return <Type size={18} className="text-amber-600" />;
  return <FileText size={18} className="text-indigo-600" />;
}

function documentType(document: ExplorerDocument) {
  const extension = document.name.split(".").pop();
  if (extension && extension !== document.name)
    return extension.toLocaleUpperCase();
  return document.mimeType.split("/").pop()?.toLocaleUpperCase() ?? "FILE";
}

export function KnowledgeExplorer({ folders }: { folders: ExplorerFolder[] }) {
  const [folderId, setFolderId] = useState(folders[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const folder = folders.find((item) => item.id === folderId) ?? folders[0];
  const items = useMemo(
    () =>
      (folder?.sources ?? [])
        .flatMap<ExplorerItem>((source) =>
          source.type === "FILE" && source.documents.length
            ? source.documents.map((document) => ({
                kind: "DOCUMENT" as const,
                key: `document-${document.id}`,
                source,
                document,
              }))
            : [
                {
                  kind: "SOURCE" as const,
                  key: `source-${source.id}`,
                  source,
                },
              ],
        )
        .filter((item) => {
          const searchable =
            item.kind === "DOCUMENT"
              ? `${item.document.name} ${item.document.mimeType} ${item.document.status}`
              : `${item.source.name} ${item.source.type} ${item.source.status}`;
          return searchable
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase());
        }),
    [folder, search],
  );
  if (!folders.length)
    return (
      <div className="grid min-h-80 place-items-center rounded-xl border border-dashed bg-card p-8 text-center">
        <div>
          <Folder size={36} className="mx-auto text-muted-foreground" />
          <h2 className="mt-3 font-semibold">No knowledge folders yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a folder, then add sources and choose which bots can use it.
          </p>
        </div>
      </div>
    );

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/80 p-3">
        <Link
          href="/workspace/admin/knowledge/new"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-white"
        >
          <Folder size={17} /> New folder
        </Link>
        <Link
          href="/workspace/sources"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium"
        >
          <LibraryBig size={17} /> Source catalog
        </Link>
        <div className="relative ml-auto min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            size={16}
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search in this folder"
            aria-label="Search sources in current folder"
            className="min-h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      <div className="grid min-h-[590px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside
          className="border-b bg-slate-50/50 p-3 lg:border-b-0 lg:border-r"
          aria-label="Knowledge folders"
        >
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Folders
          </p>
          <button className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-slate-700">
            <ChevronRight size={14} />{" "}
            <FolderOpen size={18} className="text-amber-500" /> Knowledge
          </button>
          <div className="ml-4 mt-1 space-y-1 border-l pl-2">
            {folders.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setFolderId(item.id);
                }}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
                  item.id === folder?.id
                    ? "bg-indigo-100 font-semibold text-indigo-900"
                    : "hover:bg-muted",
                )}
              >
                {item.id === folder?.id ? (
                  <FolderOpen size={18} className="text-amber-500" />
                ) : (
                  <Folder size={18} className="text-amber-500" />
                )}
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.sources.reduce(
                    (count, source) =>
                      count +
                      (source.type === "FILE" && source.documents.length
                        ? source.documents.length
                        : 1),
                    0,
                  )}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex min-h-14 items-center gap-2 border-b px-4 py-2 text-sm">
            <FolderOpen size={17} className="text-amber-500" />
            <span className="text-muted-foreground">Knowledge</span>
            <ChevronRight size={14} className="text-muted-foreground" />
            <strong className="min-w-0 flex-1 truncate">{folder?.name}</strong>
            {folder ? (
              <DeleteKnowledgeDialog
                kind="folder"
                resourceId={folder.id}
                resourceName={folder.name}
                sourceCount={folder.sources.length}
                documentCount={folder.documentCount}
                compact
              />
            ) : null}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_32px] border-b bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(180px,1fr)_120px_100px_32px]">
            <span>Name</span>
            <span className="hidden sm:block">Access</span>
            <span className="hidden text-right sm:block">Items</span>
            <span className="sr-only">Open</span>
          </div>
          <div className="divide-y">
            {items.map((item) => (
              <Link
                key={item.key}
                href={`/workspace/admin/knowledge/sources/${item.source.id}`}
                aria-label={
                  item.kind === "DOCUMENT"
                    ? `View source details for ${item.document.name}`
                    : `View details for ${item.source.name}`
                }
                className="group grid min-h-16 w-full grid-cols-[minmax(0,1fr)_32px] items-center px-4 text-left text-sm transition-colors hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none sm:grid-cols-[minmax(180px,1fr)_120px_100px_32px]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100">
                    <SourceIcon
                      type={
                        item.kind === "DOCUMENT" ? "FILE" : item.source.type
                      }
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {item.kind === "DOCUMENT"
                        ? item.document.name
                        : item.source.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.kind === "DOCUMENT"
                        ? `${documentType(item.document)} · ${item.document.status}`
                        : `${item.source.type.replaceAll("_", " ")} · ${item.source.status}`}
                    </span>
                  </span>
                </span>
                <span className="hidden sm:block">
                  <Badge
                    tone={item.source.scope === "GLOBAL" ? "success" : "info"}
                  >
                    {item.source.scope === "GLOBAL"
                      ? "Shared"
                      : `${item.source.botNames.length} bots`}
                  </Badge>
                </span>
                <span className="hidden text-right text-muted-foreground sm:block">
                  {item.kind === "DOCUMENT"
                    ? `${item.document.chunkCount} chunks`
                    : `${item.source.documentCount} files`}
                </span>
                <ChevronRight
                  size={18}
                  className="justify-self-end text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-700 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </Link>
            ))}
            {!items.length ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No sources found in this folder.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
