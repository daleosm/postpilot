export function ProgressRing({ value }: { value: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="relative h-[74px] w-[74px] shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 74 74" aria-label={`${value}% delivery health`} role="img">
        <circle cx="37" cy="37" r={radius} fill="none" stroke="#ecebe7" strokeWidth="6" />
        <circle cx="37" cy="37" r={radius} fill="none" stroke="#5f8580" strokeWidth="6" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tracking-[-0.04em] text-[#33403e]">{value}%</span>
    </div>
  );
}
