import type { ActionCatalogItem, BulkAction, TrustPolicyCatalogItem } from "../components/users/UserActionPanel";

export type AuditActionCatalogItem = {
  action: string;
  label: string;
  security: boolean;
};

export type AuditActionCatalogResponse = {
  actions: AuditActionCatalogItem[];
};

export type AvailableActionsResponse = {
  actions: BulkAction[];
};

export type ActionCatalogResponse = {
  actions: ActionCatalogItem[];
};

export type TrustPolicyCatalogResponse = {
  policies: TrustPolicyCatalogItem[];
};

