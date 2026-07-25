type SkeletonProps = { className?: string };

function Skeleton({ className = "" }: SkeletonProps) {
  return <span aria-hidden="true" className={`pp-skeleton ${className}`} />;
}

function PageHeaderSkeleton({ metrics = 3 }: { metrics?: number }) {
  return <header className="pp-page-header" aria-label="Loading page header">
    <div className="space-y-2"><Skeleton className="h-2.5 w-28" /><Skeleton className="h-8 w-52" /><Skeleton className="h-3 w-80 max-w-full" /></div>
    <div className="flex items-center gap-2"><div className="flex overflow-hidden rounded-md border border-[#e3e7e2]">{Array.from({ length: metrics }, (_, index) => <Skeleton key={index} className="h-12 w-16 rounded-none border-r border-[#e8ece7] last:border-r-0" />)}</div><Skeleton className="h-10 w-28" /></div>
  </header>;
}

export function DashboardSkeleton() {
  return <div className="space-y-5 pb-6" aria-label="Loading dashboard">
    <section className="dashboard-command-center flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div className="space-y-2"><Skeleton className="h-2.5 w-36" /><Skeleton className="h-9 w-52" /><Skeleton className="h-3.5 w-96 max-w-full" /></div><div className="flex gap-2"><Skeleton className="h-12 w-20" /><Skeleton className="h-12 w-20" /><Skeleton className="h-10 w-32" /></div></section>
    <section className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-[#edf0ec] py-1 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-[4.25rem] items-center gap-3 px-3"><Skeleton className="h-8 w-8 rounded-lg" /><div className="space-y-2"><Skeleton className="h-2.5 w-20" /><Skeleton className="h-4 w-28" /></div></div>)}</section>
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.8fr)]"><div className="panel overflow-hidden"><div className="border-b border-[#e7eae5] px-5 py-4"><Skeleton className="h-4 w-40" /><Skeleton className="mt-2 h-3 w-60" /></div>{Array.from({ length: 6 }, (_, index) => <div key={index} className="flex gap-3 px-5 py-4"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-2.5 w-20" /><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-2.5 w-1/2" /></div></div>)}</div><div className="space-y-4"><div className="panel p-5"><Skeleton className="h-4 w-36" /><div className="mt-5 space-y-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-7 w-full" />)}</div></div><div className="panel p-5"><Skeleton className="h-4 w-28" /><Skeleton className="mt-6 h-12 w-24" /><Skeleton className="mt-3 h-2 w-full" /></div></div></section>
  </div>;
}

export function RegisterPageSkeleton() {
  return <div className="pp-page" aria-label="Loading operational register"><PageHeaderSkeleton /><section className="panel p-4"><div className="flex flex-wrap gap-3"><Skeleton className="h-9 w-44" /><Skeleton className="h-9 w-36" /><Skeleton className="h-9 w-28" /></div></section><section className="panel overflow-hidden"><div className="flex justify-between border-b border-[#e7eae5] px-5 py-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-6 w-20 rounded-full" /></div>{Array.from({ length: 8 }, (_, index) => <div key={index} className="grid grid-cols-[1.3fr_.8fr_.8fr_1fr] gap-4 border-b border-[#eff1ee] px-5 py-4"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-4/5" /><Skeleton className="h-3.5 w-2/3" /></div>)}</section></div>;
}

export function BookingPageSkeleton() {
  return <div className="pp-page" aria-label="Loading bookings calendar"><PageHeaderSkeleton /><section className="panel flex items-center justify-between gap-4 p-4"><Skeleton className="h-9 w-40" /><div className="flex gap-2"><Skeleton className="h-9 w-16" /><Skeleton className="h-9 w-16" /></div></section><section className="panel overflow-hidden"><div className="grid grid-cols-[180px_repeat(5,minmax(140px,1fr))] border-b border-[#e7eae5]">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="m-3 h-7 rounded" />)}</div>{Array.from({ length: 6 }, (_, index) => <div key={index} className="grid min-h-20 grid-cols-[180px_repeat(5,minmax(140px,1fr))] border-b border-[#eff1ee]"><Skeleton className="m-4 h-4 w-28" />{Array.from({ length: 5 }, (_, cell) => <div key={cell} className="border-l border-[#f0f2ef] p-3">{(cell + index) % 3 === 0 && <Skeleton className="h-7 w-4/5 rounded-md" />}</div>)}</div>)}</section></div>;
}

export function EpisodeWorkspaceSkeleton() {
  return <div className="space-y-5" aria-label="Loading episode workspace"><Skeleton className="h-3 w-24" /><header className="panel p-6"><Skeleton className="h-3 w-44" /><Skeleton className="mt-3 h-8 w-64" /><Skeleton className="mt-3 h-6 w-72" /></header><div className="flex gap-5 border-b border-[#dfe5df] pb-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-4 w-16" />)}</div><div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]"><div className="panel h-60 p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-5 h-2 w-full" /><div className="mt-5 grid grid-cols-2 gap-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div></div><div className="panel h-60 p-5"><Skeleton className="h-4 w-28" /><div className="mt-5 space-y-3">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}</div></div></div></div>;
}
