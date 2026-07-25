import "server-only";

import { postpilotApiServerFetch } from "@/lib/postpilot-api-server";

export type CommercialFormOptions = {
  companies: Array<{ id: string; name: string; type: string }>;
  shows: Array<{ id: string; title: string }>;
  episodes: Array<{ id: string; showId: string; showTitle: string; number: number; title: string }>;
};

type ApiAllocation = {
  id: string;
  allocation_type: string;
  amount: number;
  allocation_date: string | null;
  reference: string | null;
  description: string | null;
  external_document_url?: string | null;
  created_at?: string | null;
  change_order_reference?: string | null;
  overrun_authorised?: boolean;
};

type ApiActivity = {
  id: string;
  action: string;
  created_at: string | null;
  actor_name?: string | null;
};

type ApiVendorPurchaseOrder = {
  id: string;
  vendor_company_id: string;
  vendor_name: string | null;
  show_id: string | null;
  show_title: string | null;
  episode_id: string | null;
  episode_number: number | null;
  episode_title: string | null;
  po_number: string;
  currency: string;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  notes: string | null;
  external_document_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  authorised_amount: number;
  committed_amount: number;
  actual_invoiced_amount: number;
  remaining_amount: number;
  variance_amount: number;
  allocations: ApiAllocation[];
  activity: ApiActivity[];
};

export type FrontendVendorPurchaseOrder = {
  id: string;
  vendorCompanyId: string;
  vendorName: string | null;
  showId: string | null;
  showTitle: string | null;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  poNumber: string;
  currency: string;
  issueDate: string | null;
  expiryDate: string | null;
  status: string;
  notes: string | null;
  externalDocumentUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  authorisedAmount: number;
  /** Frontend form alias for the API's `authorised_amount`. */
  approvedAmount: number;
  committedAmount: number;
  actualInvoicedAmount: number;
  remainingAmount: number;
  varianceAmount: number;
  allocations: Array<{
    id: string;
    allocationType: string;
    amount: number;
    allocationDate: string | null;
    reference: string | null;
    description: string | null;
    externalDocumentUrl: string | null;
    createdAt: string | null;
  }>;
  activity: Array<{ id: string; action: string; createdAt: string | null; actorName: string | null }>;
};

type ApiClientPurchaseOrder = {
  id: string;
  client_company_id: string;
  client_name: string | null;
  show_id: string | null;
  show_title: string | null;
  episode_id: string | null;
  episode_number: number | null;
  episode_title: string | null;
  po_number: string;
  currency: string;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  notes: string | null;
  external_document_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  authorised_amount: number;
  committed_to_bill_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
  variance_amount: number;
  allocations: ApiAllocation[];
  activity: ApiActivity[];
};

export type FrontendClientPurchaseOrder = {
  id: string;
  clientCompanyId: string;
  clientName: string | null;
  showId: string | null;
  showTitle: string | null;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  poNumber: string;
  currency: string;
  issueDate: string | null;
  expiryDate: string | null;
  status: string;
  notes: string | null;
  externalDocumentUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  authorisedAmount: number;
  /** Frontend form alias for the API's `authorised_amount`. */
  approvedAmount: number;
  committedToBillAmount: number;
  invoicedAmount: number;
  remainingAmount: number;
  varianceAmount: number;
  allocations: Array<{
    id: string;
    allocationType: string;
    amount: number;
    allocationDate: string | null;
    reference: string | null;
    description: string | null;
    changeOrderReference: string | null;
    overrunAuthorised: boolean;
    createdAt: string | null;
  }>;
  activity: Array<{ id: string; action: string; createdAt: string | null; actorName: string | null }>;
};

export async function getFastApiCommercialFormOptions(): Promise<CommercialFormOptions> {
  const response = await postpilotApiServerFetch<{
    companies: CommercialFormOptions["companies"];
    shows: CommercialFormOptions["shows"];
    episodes: Array<{ id: string; show_id: string; show_title: string; number: number; title: string }>;
  }>("/budget/options");
  return {
    companies: response.companies,
    shows: response.shows,
    episodes: response.episodes.map((episode) => ({
      id: episode.id,
      showId: episode.show_id,
      showTitle: episode.show_title,
      number: episode.number,
      title: episode.title,
    })),
  };
}

function mapActivity(activity: ApiActivity[]) {
  return activity.map((item) => ({
    id: item.id,
    action: item.action,
    createdAt: item.created_at,
    actorName: item.actor_name ?? null,
  }));
}

function mapVendorPurchaseOrder(order: ApiVendorPurchaseOrder): FrontendVendorPurchaseOrder {
  return {
    id: order.id,
    vendorCompanyId: order.vendor_company_id,
    vendorName: order.vendor_name,
    showId: order.show_id,
    showTitle: order.show_title,
    episodeId: order.episode_id,
    episodeNumber: order.episode_number,
    episodeTitle: order.episode_title,
    poNumber: order.po_number,
    currency: order.currency,
    issueDate: order.issue_date,
    expiryDate: order.expiry_date,
    status: order.status,
    notes: order.notes,
    externalDocumentUrl: order.external_document_url,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    authorisedAmount: order.authorised_amount,
    approvedAmount: order.authorised_amount,
    committedAmount: order.committed_amount,
    actualInvoicedAmount: order.actual_invoiced_amount,
    remainingAmount: order.remaining_amount,
    varianceAmount: order.variance_amount,
    allocations: order.allocations.map((item) => ({
      id: item.id,
      allocationType: item.allocation_type,
      amount: item.amount,
      allocationDate: item.allocation_date,
      reference: item.reference,
      description: item.description,
      externalDocumentUrl: item.external_document_url ?? null,
      createdAt: item.created_at ?? null,
    })),
    activity: mapActivity(order.activity),
  };
}

function mapClientPurchaseOrder(order: ApiClientPurchaseOrder): FrontendClientPurchaseOrder {
  return {
    id: order.id,
    clientCompanyId: order.client_company_id,
    clientName: order.client_name,
    showId: order.show_id,
    showTitle: order.show_title,
    episodeId: order.episode_id,
    episodeNumber: order.episode_number,
    episodeTitle: order.episode_title,
    poNumber: order.po_number,
    currency: order.currency,
    issueDate: order.issue_date,
    expiryDate: order.expiry_date,
    status: order.status,
    notes: order.notes,
    externalDocumentUrl: order.external_document_url,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    authorisedAmount: order.authorised_amount,
    approvedAmount: order.authorised_amount,
    committedToBillAmount: order.committed_to_bill_amount,
    invoicedAmount: order.invoiced_amount,
    remainingAmount: order.remaining_amount,
    varianceAmount: order.variance_amount,
    allocations: order.allocations.map((item) => ({
      id: item.id,
      allocationType: item.allocation_type,
      amount: item.amount,
      allocationDate: item.allocation_date,
      reference: item.reference,
      description: item.description,
      changeOrderReference: item.change_order_reference ?? null,
      overrunAuthorised: item.overrun_authorised ?? false,
      createdAt: item.created_at ?? null,
    })),
    activity: mapActivity(order.activity),
  };
}

export async function listFastApiVendorPurchaseOrders() {
  const response = await postpilotApiServerFetch<{ purchase_orders: ApiVendorPurchaseOrder[] }>("/purchase-orders");
  return response.purchase_orders.map(mapVendorPurchaseOrder);
}

export async function getFastApiVendorPurchaseOrder(id: string) {
  return mapVendorPurchaseOrder(await postpilotApiServerFetch<ApiVendorPurchaseOrder>(`/purchase-orders/${id}`));
}

export async function listFastApiClientPurchaseOrders() {
  const response = await postpilotApiServerFetch<{ client_purchase_orders: ApiClientPurchaseOrder[] }>("/client-purchase-orders");
  return response.client_purchase_orders.map(mapClientPurchaseOrder);
}

export async function getFastApiClientPurchaseOrder(id: string) {
  return mapClientPurchaseOrder(await postpilotApiServerFetch<ApiClientPurchaseOrder>(`/client-purchase-orders/${id}`));
}
