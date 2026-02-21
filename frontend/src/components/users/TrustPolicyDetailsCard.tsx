import Card from "../ui/Card";
import type { TrustPolicy, TrustPolicyCatalogItem } from "./UserActionPanel";
import TrustPolicyDetailChips from "./TrustPolicyDetailChips";

export default function TrustPolicyDetailsCard({
  trustPolicy,
  trustPolicyCatalog,
  title = "Параметры доверия",
}: {
  trustPolicy: TrustPolicy;
  trustPolicyCatalog: Record<TrustPolicy, TrustPolicyCatalogItem>;
  title?: string;
}) {
  const policy = trustPolicyCatalog[trustPolicy];
  if (!policy) return null;

  return (
    <Card style={{ padding: 10, background: "rgba(255,255,255,0.03)" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.88 }}>{policy.description}</div>
        <TrustPolicyDetailChips policy={policy} />
      </div>
    </Card>
  );
}
