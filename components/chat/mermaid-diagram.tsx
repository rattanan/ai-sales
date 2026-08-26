"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Mermaid is by far the heaviest renderer in the chat, so it is imported only
 * once a diagram actually appears in an answer.
 *
 * `securityLevel: "strict"` is not optional: the diagram source is written by
 * the model from retrieved content, so it is untrusted input to an SVG
 * generator. Strict mode disables click handlers and inline HTML in labels.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(`mermaid-${id}`, source);
        if (cancelled || !container.current) return;
        container.current.innerHTML = svg;
        // Cleared on success rather than up front, so re-rendering a fixed
        // diagram drops the previous error without a synchronous setState.
        setError(null);
      } catch (reason) {
        if (cancelled) return;
        // A half-streamed or malformed diagram is expected, not exceptional.
        setError(
          reason instanceof Error ? reason.message : "ไม่สามารถวาดไดอะแกรมได้",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (error)
    return (
      <figure className="my-2">
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-5">
          <code>{source}</code>
        </pre>
        <figcaption className="mt-1 text-xs text-amber-700">
          ไดอะแกรมนี้วาดไม่ได้ จึงแสดงเป็นซอร์สโค้ดแทน
        </figcaption>
      </figure>
    );

  return (
    <div
      ref={container}
      role="img"
      aria-label="ไดอะแกรม Mermaid"
      className="my-2 overflow-x-auto rounded-lg border bg-white p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
    />
  );
}
