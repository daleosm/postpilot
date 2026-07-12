import { redirect } from "next/navigation";

/** Kept only so old bookmarks land on the workflow-oriented review queue. */
export default function LegacyAssetsPage() {
  redirect("/review");
}
