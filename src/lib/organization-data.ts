export type OrganizationMembership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  currency: string;
  role: "owner" | "admin" | "member" | "client";
};
