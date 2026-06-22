/** Animated "X is typing…" row shown at the bottom of the thread. */
export function TypingIndicator({ names }: { names: string[] }) {
  if (!names.length) return null
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names[0]} and ${names.length - 1} others are typing`
  return (
    <div className="flex items-center gap-2 px-4 py-1 text-xs text-slate-400">
      <span className="flex items-center gap-1">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
      <span className="truncate">{label}…</span>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
      style={{ animationDelay: delay }}
    />
  )
}
