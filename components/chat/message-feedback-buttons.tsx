"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { submitMessageFeedbackAction } from "@/features/chat/actions";

export function MessageFeedbackButtons({
  messageId,
  initialRating = null,
}: {
  messageId: string;
  initialRating?: number | null;
}) {
  const [rating, setRating] = useState(initialRating);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(ratingValue: 1 | -1) {
    const formData = new FormData();
    formData.set("messageId", messageId);
    formData.set("rating", String(ratingValue));
    formData.set("reason", ratingValue === 1 ? "CORRECT" : "INCORRECT");

    setStatus("");
    startTransition(async () => {
      try {
        const result = await submitMessageFeedbackAction(formData);
        if (!result.ok) {
          setStatus(result.error);
          return;
        }
        setRating(result.rating);
        setStatus(result.rating === 1 ? "Saved as helpful" : "Feedback saved");
      } catch {
        setStatus("Could not save feedback. Please try again.");
      }
    });
  }

  return (
    <div className="flex min-h-11 items-center gap-1">
      <button
        type="button"
        aria-label="Helpful answer"
        aria-pressed={rating === 1}
        disabled={pending}
        onClick={() => submit(1)}
        className={`grid size-11 place-items-center rounded-lg transition-colors disabled:cursor-wait disabled:opacity-60 ${
          rating === 1
            ? "bg-emerald-100 text-emerald-700"
            : "hover:bg-emerald-50"
        }`}
      >
        <ThumbsUp size={15} fill={rating === 1 ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label="Unhelpful answer"
        aria-pressed={rating === -1}
        disabled={pending}
        onClick={() => submit(-1)}
        className={`grid size-11 place-items-center rounded-lg transition-colors disabled:cursor-wait disabled:opacity-60 ${
          rating === -1 ? "bg-red-100 text-red-700" : "hover:bg-red-50"
        }`}
      >
        <ThumbsDown size={15} fill={rating === -1 ? "currentColor" : "none"} />
      </button>
      <span
        role="status"
        aria-live="polite"
        className={`ml-1 text-xs ${
          status.startsWith("Could not") || status === "Invalid feedback."
            ? "text-destructive"
            : "text-muted-foreground"
        }`}
      >
        {pending ? "Saving…" : status}
      </span>
    </div>
  );
}
