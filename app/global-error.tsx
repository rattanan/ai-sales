"use client";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            fontFamily: "sans-serif",
            maxWidth: 640,
            margin: "80px auto",
            padding: 24,
          }}
        >
          <h1>InsightKM could not start</h1>
          <p>Please check the application configuration and try again.</p>
          <button
            onClick={() => unstable_retry()}
            style={{ padding: "12px 18px" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
