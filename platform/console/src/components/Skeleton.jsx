// Skeleton coerenti con le shape reali delle card della console.
export function AppCardSkeleton() {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="skeleton h-5 w-1/2" />
        <div className="skeleton h-5 w-16 rounded-full" />
      </div>
      <div className="skeleton h-3 w-1/3" />
      <div className="flex gap-3 pt-2">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-3 w-16" />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card p-5">
      <div className="skeleton h-3 w-24 mb-3" />
      <div className="skeleton h-7 w-12" />
    </div>
  );
}
