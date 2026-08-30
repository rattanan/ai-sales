"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Root, RootContent } from "mdast";
import type { PluggableList } from "unified";
import { Check, Copy } from "lucide-react";
import {
  CitationSource,
  type ChatCitation,
} from "@/components/chat/citation-sources";
import { MermaidDiagram } from "@/components/chat/mermaid-diagram";

/**
 * Raw HTML is deliberately NOT enabled: `rehype-raw` is absent, so arbitrary
 * markup from the model cannot reach the DOM. The remark plugin below converts
 * only an exact, attribute-free `<br>` tag into a Markdown line-break node.
 */
function remarkSafeLineBreaks() {
  return (tree: Root) => {
    const replaceLineBreaks = (children: RootContent[]) => {
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.type === "html" && /^<br\s*\/?>$/i.test(child.value)) {
          children[index] = { type: "break" };
          continue;
        }
        if ("children" in child) {
          replaceLineBreaks(child.children as RootContent[]);
        }
      }
    };

    replaceLineBreaks(tree.children);
  };
}

const REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkMath,
  remarkSafeLineBreaks,
];
const REHYPE_PLUGINS: PluggableList = [
  rehypeKatex,
  // `detect` keeps an unlabelled fence highlighted instead of falling back to
  // plain text, which is what the model produces most of the time.
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
];

/** Only these schemes may become a link; everything else renders as text. */
function safeHref(href: string | undefined) {
  if (!href) return null;
  try {
    const url = new URL(href, "https://placeholder.invalid");
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? href
      : null;
  } catch {
    return null;
  }
}

function CodeBlock({
  language,
  children,
  raw,
}: {
  language: string | null;
  children: ReactNode;
  raw: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-2">
      {language ? (
        <span className="absolute top-2 left-3 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {language}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(raw).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute top-1.5 right-1.5 flex min-h-8 min-w-8 items-center justify-center rounded-lg border bg-white/90 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
        aria-label={copied ? "คัดลอกแล้ว" : "คัดลอกโค้ด"}
      >
        {copied ? (
          <Check size={13} className="text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
      </button>
      <pre
        className={`overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-5 ${language ? "pt-6" : ""}`}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * Turns the `[3]` markers the model writes into buttons that reveal the matching
 * source. The markers come from the evidence numbering the agent was shown, so
 * they line up with the stored citation ranks.
 */
function withCitationChips(
  text: string,
  citations: ChatCitation[],
  onCite: ((rank: number) => void) | undefined,
) {
  if (!onCite && !citations.length) return text;
  const parts = text.split(/(\[\d{1,3}\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    const rank = /^\[(\d{1,3})\]$/.exec(part)?.[1];
    if (!rank) return <Fragment key={index}>{part}</Fragment>;
    const citation = citations.find((item) => item.rank === Number(rank));
    if (citation)
      return (
        <CitationSource
          key={index}
          citation={citation}
          variant="number"
          onPreview={onCite}
        />
      );
    if (!onCite) return <Fragment key={index}>{part}</Fragment>;
    return (
      <button
        key={index}
        type="button"
        onClick={() => onCite(Number(rank))}
        className="mx-0.5 inline-flex min-h-5 items-center rounded bg-primary/15 px-1 align-baseline text-[11px] font-medium text-primary tabular-nums hover:bg-primary/25"
        aria-label={`ดูแหล่งอ้างอิงที่ ${rank}`}
      >
        {rank}
      </button>
    );
  });
}

function decorateChildren(
  children: ReactNode,
  citations: ChatCitation[],
  onCite: ((rank: number) => void) | undefined,
): ReactNode {
  if (typeof children === "string")
    return withCitationChips(children, citations, onCite);
  if (Array.isArray(children))
    return children.map((child, index) => (
      <Fragment key={index}>
        {decorateChildren(child, citations, onCite)}
      </Fragment>
    ));
  return children;
}

export function MarkdownMessage({
  content,
  citations = [],
  onCite,
}: {
  content: string;
  /** Stored, tenant-scoped evidence used to populate inline source previews. */
  citations?: ChatCitation[];
  /** Called with a citation rank when the reader taps a `[n]` marker. */
  onCite?: (rank: number) => void;
}) {
  const components = useMemo(
    () => ({
      p: ({ children }: { children?: ReactNode }) => (
        <p className="my-2 first:mt-0 last:mb-0">
          {decorateChildren(children, citations, onCite)}
        </p>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li className="my-0.5">
          {decorateChildren(children, citations, onCite)}
        </li>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="my-2 list-disc space-y-0.5 pl-5">{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="my-2 list-decimal space-y-0.5 pl-5">{children}</ol>
      ),
      h1: ({ children }: { children?: ReactNode }) => (
        <h3 className="mt-3 mb-1 text-base font-semibold first:mt-0">
          {children}
        </h3>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0">
          {children}
        </h4>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h5 className="mt-2 mb-1 text-sm font-semibold first:mt-0">
          {children}
        </h5>
      ),
      strong: ({ children }: { children?: ReactNode }) => (
        <strong className="font-semibold">{children}</strong>
      ),
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-3" />,
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const safe = safeHref(href);
        if (!safe) return <span>{children}</span>;
        return (
          <a
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline"
          >
            {children}
          </a>
        );
      },
      // A wide table scrolls inside its own box so the chat column never does.
      table: ({ children }: { children?: ReactNode }) => (
        <div className="my-2 overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-xs">{children}</table>
        </div>
      ),
      thead: ({ children }: { children?: ReactNode }) => (
        <thead className="bg-muted">{children}</thead>
      ),
      th: ({ children }: { children?: ReactNode }) => (
        <th className="border-b px-2 py-1.5 text-left font-semibold">
          {children}
        </th>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td className="border-b px-2 py-1.5 align-top">
          {decorateChildren(children, citations, onCite)}
        </td>
      ),
      code: ({
        className,
        children,
      }: {
        className?: string;
        children?: ReactNode;
      }) => {
        const inline = !className?.includes("language-");
        if (inline)
          return (
            <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
              {children}
            </code>
          );
        return <code className={className}>{children}</code>;
      },
      pre: ({ children }: { children?: ReactNode }) => {
        const child = Array.isArray(children) ? children[0] : children;
        const props =
          child && typeof child === "object" && "props" in child
            ? (child.props as { className?: string; children?: ReactNode })
            : undefined;
        const language =
          /language-([\w+-]+)/.exec(props?.className ?? "")?.[1] ?? null;
        const raw =
          typeof props?.children === "string"
            ? props.children
            : Array.isArray(props?.children)
              ? props.children
                  .filter((part) => typeof part === "string")
                  .join("")
              : "";
        if (language === "mermaid") return <MermaidDiagram source={raw} />;
        return (
          <CodeBlock language={language} raw={raw}>
            {children}
          </CodeBlock>
        );
      },
    }),
    [citations, onCite],
  );

  return (
    <div className="text-sm leading-6 break-words [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}
