import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panel mx-auto mt-16 max-w-lg p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#7c827f]">PostPilot</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#28302d]">Page not found</h1>
      <p className="mt-2 text-sm leading-6 text-[#747b77]">This record is unavailable or you do not have access to it in this post house.</p>
      <Link href="/" className="mt-5 inline-flex rounded-md bg-[#263130] px-3 py-2 text-sm font-medium text-white hover:bg-[#354340]">Return to dashboard</Link>
    </section>
  );
}
