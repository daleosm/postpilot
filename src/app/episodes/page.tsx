import { redirect } from "next/navigation";

/**
 * The production register is show-first. Keep legacy /episodes bookmarks
 * useful without maintaining a second, tenant-wide episode list.
 */
export default function EpisodesPage() {
  redirect("/shows");
}
