import type { NtopActionType } from "@/generated/prisma/client";

export const ntopToolRegistry = {
  search_ntop: { access: "READ", description: "Search Customer, Prospect, Lead, Opportunity, Quotation, and Product facts in NTOP." },
  get_customer: { access: "READ", description: "Read an authorized NTOP Customer 360 record." },
  get_opportunity: { access: "READ", description: "Read an authorized NTOP Opportunity and related business facts." },
  create_prospect: { access: "WRITE", description: "Create a Prospect after explicit user confirmation." },
  create_lead: { access: "WRITE", description: "Create a Lead after explicit user confirmation." },
  create_opportunity: { access: "WRITE", description: "Create an Opportunity after explicit user confirmation." },
  update_opportunity: { access: "WRITE", description: "Update an Opportunity after explicit user confirmation." },
  create_quotation: { access: "WRITE", description: "Create a Quotation draft after explicit user confirmation." },
} as const;

export type NtopToolName = keyof typeof ntopToolRegistry;

export const ntopActionTool: Record<NtopActionType, NtopToolName> = {
  CREATE_PROSPECT: "create_prospect",
  CREATE_LEAD: "create_lead",
  CREATE_OPPORTUNITY: "create_opportunity",
  UPDATE_OPPORTUNITY: "update_opportunity",
  CREATE_QUOTATION: "create_quotation",
};

export function requireConfirmedNtopWrite(tool: NtopToolName, confirmed: boolean) {
  if (ntopToolRegistry[tool].access === "WRITE" && !confirmed) throw new Error("NTOP write tools require explicit user confirmation.");
}
