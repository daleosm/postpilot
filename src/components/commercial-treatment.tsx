export type CommercialTreatment = "wet_hire" | "dry_hire" | "flat_project_fee";
export type CommercialTreatmentValue = CommercialTreatment | null | undefined;

const details: Record<CommercialTreatment, { label: string; summary: string; className: string }> = {
  wet_hire: {
    label: "Wet hire",
    summary: "Room and assigned artist are charged as separate operational components.",
    className: "border-[#cfe0d5] bg-[#eef6f0] text-[#416b58]",
  },
  dry_hire: {
    label: "Dry hire",
    summary: "Room capacity is charged; an artist is not included automatically.",
    className: "border-[#d8dde7] bg-[#f1f4f8] text-[#526777]",
  },
  flat_project_fee: {
    label: "Flat project fee",
    summary: "One agreed client fee; scheduled room and artist time remains internal cost.",
    className: "border-[#eadbc2] bg-[#fff8e9] text-[#896334]",
  },
};

const reviewRequired = {
  label: "Commercial review required",
  summary: "Historic commercial treatment was not confirmed; review the original agreement before billing changes.",
  className: "border-[#ead7c7] bg-[#fdf4ed] text-[#8a5d42]",
};

export function commercialTreatmentDetails(treatment: CommercialTreatmentValue) {
  return treatment ? details[treatment] : reviewRequired;
}

export function CommercialTreatmentBadge({ treatment, className = "" }: { treatment: CommercialTreatmentValue; className?: string }) {
  const detail = commercialTreatmentDetails(treatment);
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${detail.className} ${className}`}>{detail.label}</span>;
}

export function CommercialTreatmentSummary({ treatment, className = "" }: { treatment: CommercialTreatmentValue; className?: string }) {
  const detail = commercialTreatmentDetails(treatment);
  return <p className={`text-xs leading-5 text-[#6e7973] ${className}`}>{detail.summary}</p>;
}
