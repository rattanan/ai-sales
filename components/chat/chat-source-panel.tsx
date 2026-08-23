"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type ChatKnowledgeSource = {
  id: string;
  name: string;
  type: string;
  folderId: string;
  folderName: string;
  documents: Array<{ id: string; name: string; mimeType: string }>;
};

type SourceFolder = {
  id: string;
  name: string;
  sources: ChatKnowledgeSource[];
};

export function selectedChatSourceScope(
  sources: ChatKnowledgeSource[],
  selectedDocumentIds: ReadonlySet<string>,
) {
  const sourceIds: string[] = [];
  const documentIds: string[] = [];

  for (const source of sources) {
    const selected = source.documents.filter((document) =>
      selectedDocumentIds.has(document.id),
    );
    if (selected.length > 0 && selected.length === source.documents.length)
      sourceIds.push(source.id);
    else documentIds.push(...selected.map((document) => document.id));
  }

  return { sourceIds, documentIds };
}

function groupSources(sources: ChatKnowledgeSource[]): SourceFolder[] {
  const folders = new Map<string, SourceFolder>();
  for (const source of sources) {
    const folder = folders.get(source.folderId) ?? {
      id: source.folderId,
      name: source.folderName,
      sources: [],
    };
    folder.sources.push(source);
    folders.set(source.folderId, folder);
  }
  return [...folders.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function TreeCheckbox({
  id,
  checked,
  indeterminate = false,
  label,
  disabled = false,
  onChange,
}: {
  id: string;
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className="size-4 shrink-0 cursor-pointer accent-amber-500 disabled:cursor-not-allowed"
    />
  );
}

export function ChatSourcePanel({
  sources,
  selectedDocumentIds,
  onSelectionChange,
  onClose,
}: {
  sources: ChatKnowledgeSource[];
  selectedDocumentIds: ReadonlySet<string>;
  onSelectionChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const folders = useMemo(() => groupSources(sources), [sources]);
  const allDocumentIds = useMemo(
    () => sources.flatMap((source) => source.documents.map(({ id }) => id)),
    [sources],
  );
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(
    () =>
      new Set([
        ...folders.map((folder) => `folder:${folder.id}`),
        ...sources.map((source) => `source:${source.id}`),
      ]),
  );

  const visibleFolders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return folders;
    return folders
      .map((folder) => {
        if (folder.name.toLocaleLowerCase().includes(normalized)) return folder;
        const matchingSources = folder.sources
          .map((source) => {
            if (
              `${source.name} ${source.type}`
                .toLocaleLowerCase()
                .includes(normalized)
            )
              return source;
            const documents = source.documents.filter((document) =>
              document.name.toLocaleLowerCase().includes(normalized),
            );
            return documents.length ? { ...source, documents } : null;
          })
          .filter((source): source is ChatKnowledgeSource => Boolean(source));
        return matchingSources.length
          ? { ...folder, sources: matchingSources }
          : null;
      })
      .filter((folder): folder is SourceFolder => Boolean(folder));
  }, [folders, query]);

  function toggleExpanded(key: string) {
    setExpanded((items) => {
      const next = new Set(items);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleDocuments(ids: string[], checked: boolean) {
    const next = new Set(selectedDocumentIds);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onSelectionChange([...next]);
  }

  const allSelected =
    allDocumentIds.length > 0 &&
    allDocumentIds.every((id) => selectedDocumentIds.has(id));
  const someSelected = allDocumentIds.some((id) => selectedDocumentIds.has(id));

  return (
    <aside
      id="chat-source-panel"
      aria-label="Chat sources"
      className="fixed inset-y-4 right-4 z-50 flex w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl 2xl:static 2xl:inset-auto 2xl:z-auto 2xl:w-auto 2xl:shadow-sm"
    >
      <div className="flex items-start gap-3 border-b p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Sources</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Select a folder, a source, or individual files for the next answer.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Close source panel"
          onClick={onClose}
          className="size-9 px-0"
        >
          <X size={18} />
        </Button>
      </div>

      <div className="border-b p-3">
        <div className="relative">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
          />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter sources and files"
            placeholder="Filter sources or files"
            className="min-h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      <fieldset className="min-h-0 flex-1 overflow-y-auto p-3">
        <legend className="sr-only">Choose chat sources</legend>
        <div className="flex min-h-11 items-center gap-2 rounded-lg bg-muted px-3">
          <TreeCheckbox
            id="chat-source-all"
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            disabled={!allDocumentIds.length}
            label="Select all accessible files"
            onChange={(checked) => toggleDocuments(allDocumentIds, checked)}
          />
          <label
            htmlFor="chat-source-all"
            className="min-w-0 flex-1 cursor-pointer text-sm font-semibold"
          >
            All accessible files
          </label>
          <span className="text-xs text-muted-foreground">
            {allDocumentIds.length}
          </span>
        </div>

        <div className="mt-2 space-y-1">
          {visibleFolders.map((folder) => {
            const folderKey = `folder:${folder.id}`;
            const fullFolder = folders.find((item) => item.id === folder.id)!;
            const folderDocumentIds = fullFolder.sources.flatMap((source) =>
              source.documents.map(({ id }) => id),
            );
            const selectedInFolder = folderDocumentIds.filter((id) =>
              selectedDocumentIds.has(id),
            ).length;
            const folderChecked =
              folderDocumentIds.length > 0 &&
              selectedInFolder === folderDocumentIds.length;
            const folderOpen = expanded.has(folderKey) || Boolean(query);

            return (
              <div key={folder.id} className="rounded-xl border bg-background">
                <div className="flex min-h-11 items-center gap-1 px-2">
                  <button
                    type="button"
                    aria-label={`${folderOpen ? "Collapse" : "Expand"} folder ${folder.name}`}
                    aria-expanded={folderOpen}
                    onClick={() => toggleExpanded(folderKey)}
                    className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-muted"
                  >
                    {folderOpen ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  <TreeCheckbox
                    id={`chat-folder-${folder.id}`}
                    checked={folderChecked}
                    indeterminate={selectedInFolder > 0 && !folderChecked}
                    disabled={!folderDocumentIds.length}
                    label={`Select folder ${folder.name}`}
                    onChange={(checked) =>
                      toggleDocuments(folderDocumentIds, checked)
                    }
                  />
                  <label
                    htmlFor={`chat-folder-${folder.id}`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-medium"
                  >
                    <Folder
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-amber-600"
                    />
                    <span className="truncate">{folder.name}</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedInFolder}/{folderDocumentIds.length}
                  </span>
                </div>

                {folderOpen ? (
                  <div className="border-t px-2 py-1.5">
                    {folder.sources.map((source) => {
                      const sourceKey = `source:${source.id}`;
                      const fullSource = sources.find(
                        (item) => item.id === source.id,
                      )!;
                      const sourceDocumentIds = fullSource.documents.map(
                        ({ id }) => id,
                      );
                      const selectedInSource = sourceDocumentIds.filter((id) =>
                        selectedDocumentIds.has(id),
                      ).length;
                      const sourceChecked =
                        sourceDocumentIds.length > 0 &&
                        selectedInSource === sourceDocumentIds.length;
                      const sourceOpen =
                        expanded.has(sourceKey) || Boolean(query);

                      return (
                        <div key={source.id}>
                          <div className="flex min-h-10 items-center gap-1 pl-3">
                            <button
                              type="button"
                              aria-label={`${sourceOpen ? "Collapse" : "Expand"} source ${source.name}`}
                              aria-expanded={sourceOpen}
                              onClick={() => toggleExpanded(sourceKey)}
                              className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-muted"
                            >
                              {sourceOpen ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                            </button>
                            <TreeCheckbox
                              id={`chat-knowledge-source-${source.id}`}
                              checked={sourceChecked}
                              indeterminate={
                                selectedInSource > 0 && !sourceChecked
                              }
                              disabled={!sourceDocumentIds.length}
                              label={`Select source ${source.name}`}
                              onChange={(checked) =>
                                toggleDocuments(sourceDocumentIds, checked)
                              }
                            />
                            <label
                              htmlFor={`chat-knowledge-source-${source.id}`}
                              className="min-w-0 flex-1 cursor-pointer pl-1"
                            >
                              <span className="block truncate text-sm">
                                {source.name}
                              </span>
                              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                                {source.type}
                              </span>
                            </label>
                          </div>

                          {sourceOpen ? (
                            <div className="ml-10 border-l pl-3">
                              {source.documents.map((document) => (
                                <div
                                  key={document.id}
                                  className="flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted"
                                >
                                  <TreeCheckbox
                                    id={`chat-document-${document.id}`}
                                    checked={selectedDocumentIds.has(
                                      document.id,
                                    )}
                                    label={`Select file ${document.name}`}
                                    onChange={(checked) =>
                                      toggleDocuments([document.id], checked)
                                    }
                                  />
                                  <label
                                    htmlFor={`chat-document-${document.id}`}
                                    title={document.name}
                                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm"
                                  >
                                    <FileText
                                      size={14}
                                      aria-hidden="true"
                                      className="shrink-0 text-muted-foreground"
                                    />
                                    <span className="truncate">
                                      {document.name}
                                    </span>
                                  </label>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!sources.length ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">
            No indexed files are available to you yet.
          </div>
        ) : !visibleFolders.length ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">
            No sources or files match your filter.
          </div>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3 border-t bg-muted/40 p-3">
        <p
          aria-live="polite"
          className="min-w-0 flex-1 text-xs text-muted-foreground"
        >
          <span className="font-semibold text-foreground">
            {selectedDocumentIds.size} file
            {selectedDocumentIds.size === 1 ? "" : "s"}
          </span>{" "}
          selected for the next answer
        </p>
        {selectedDocumentIds.size ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onSelectionChange([])}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
