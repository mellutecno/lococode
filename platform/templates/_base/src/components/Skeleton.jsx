// Skeleton card per la griglia membri. Stessa shape della MemberCard reale
// cosi' il layout non balla quando arrivano i dati.
export function MemberCardSkeleton() {
  return (
    <div className="card p-5 flex gap-4">
      <div className="skeleton w-14 h-14 rounded-2xl flex-shrink-0" />
      <div className="flex-1 space-y-2.5 min-w-0">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-5 w-20 rounded-full mt-1" />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card p-5">
      <div className="skeleton h-3 w-20 mb-3" />
      <div className="skeleton h-7 w-16" />
    </div>
  );
}
