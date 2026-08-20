export default function Loading() {
  return (
    <div className="animate-pulse space-y-7" aria-label="Loading workspace">
      <div className="h-9 w-64 rounded-lg bg-slate-200" />
      <div className="h-5 w-full max-w-xl rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-28 rounded-xl border bg-white" />
        ))}
      </div>
      <div className="h-64 rounded-xl border bg-white" />
    </div>
  );
}
