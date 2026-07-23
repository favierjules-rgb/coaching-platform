export function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
