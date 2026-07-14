import { redirect } from "next/navigation";

/** Purchase orders are retained as dormant historical finance records, not a live workflow. */
export default function PurchaseOrdersPage() {
  redirect("/crm");
}
