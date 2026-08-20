import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  FileText,
  LockKeyhole,
  MessageSquareText,
  Quote,
  Sparkles,
} from "lucide-react";
import { auth } from "@/auth";
import {
  InsightKmMark,
  InsightKmWordmark,
} from "@/components/brand/insightkm-mark";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  if ((await auth())?.user?.id) redirect("/workspace");
  return (
    <main id="main-content" className="min-h-dvh bg-white">
      <nav
        className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8"
        aria-label="Primary navigation"
      >
        <Link href="/" className="flex items-center gap-3">
          <InsightKmMark />
          <InsightKmWordmark />
        </Link>
        <Button asChild variant="ghost">
          <Link href="/login">Sign in</Link>
        </Button>
      </nav>

      <section className="relative overflow-hidden border-y bg-[linear-gradient(135deg,#fbfbff_0%,#f3f2ff_50%,#f4fbff_100%)]">
        <div className="pointer-events-none absolute left-1/2 top-0 size-[38rem] -translate-x-1/2 -translate-y-2/3 rounded-full bg-indigo-300/25 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.02fr_.98fr] lg:py-28">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm backdrop-blur">
              <Sparkles size={14} /> Enterprise knowledge, grounded by AI
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-slate-950 sm:text-6xl">
              Turn trusted knowledge into confident decisions.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              InsightKM brings documents, databases, and business systems into
              one secure AI knowledge platform—with governed access and clear
              citations in every answer.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <Link href="/login">
                  Open your workspace <ArrowRight size={18} />
                </Link>
              </Button>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="text-emerald-600" size={17} />
                Built for private enterprise use
              </span>
            </div>
          </div>

          <div
            className="relative rounded-[1.5rem] border bg-white p-4 shadow-[0_28px_80px_rgba(36,34,80,0.15)] sm:p-5"
            aria-label="InsightKM product preview"
          >
            <div className="flex items-center gap-3 border-b pb-4">
              <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary">
                <Bot size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  Policy Knowledge Assistant
                </p>
                <p className="text-xs text-muted-foreground">
                  HR policies · Finance procedures · Internal guidelines
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Active
              </span>
            </div>
            <div className="space-y-4 py-5">
              <div className="ml-auto max-w-[84%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-white">
                What is the approval process for external training expenses?
              </div>
              <div className="max-w-[92%] rounded-2xl rounded-bl-md border bg-slate-50 px-4 py-3.5">
                <p className="text-sm leading-6 text-slate-700">
                  External training requires your manager&apos;s approval first.
                  Requests above ฿20,000 also need the department head and
                  Finance to review the budget before registration.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Citation
                    icon={<FileText />}
                    label="Training Policy · p. 6"
                  />
                  <Citation icon={<Quote />} label="Finance SOP · §3.2" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm">
              <MessageSquareText size={17} /> Ask your organization&apos;s
              knowledge…
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
        <div className="mb-9 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            One governed knowledge layer
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Useful answers without compromising control.
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <Feature
            icon={<BookOpenCheck />}
            title="Connected knowledge"
            text="Bring governed databases and business files into a shared knowledge foundation."
          />
          <Feature
            icon={<Bot />}
            title="Grounded AI"
            text="Use compatible AI providers with validated context and visible source citations."
          />
          <Feature
            icon={<LockKeyhole />}
            title="Enterprise trust"
            text="Apply role-aware access, read-only controls, encrypted credentials, and audit trails."
          />
        </div>
      </section>
    </main>
  );
}

function Citation({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-[11px] font-medium text-slate-600 [&>svg]:size-3">
      {icon} {label}
    </span>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_16px_38px_rgba(31,31,78,0.08)]">
      <div className="mb-5 grid size-11 place-items-center rounded-xl bg-secondary text-primary">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
