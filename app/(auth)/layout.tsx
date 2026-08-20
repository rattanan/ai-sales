import Link from "next/link";
import {
  InsightKmMark,
  InsightKmWordmark,
} from "@/components/brand/insightkm-mark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-10"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_-20%,rgba(99,102,241,0.18),transparent_66%)]" />
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-3">
          <InsightKmMark />
          <InsightKmWordmark />
        </Link>
        {children}
      </div>
    </main>
  );
}
