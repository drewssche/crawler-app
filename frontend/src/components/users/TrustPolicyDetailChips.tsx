import AccentPill from "../ui/AccentPill";
import type { TrustPolicyCatalogItem } from "./UserActionPanel";

export default function TrustPolicyDetailChips({
  policy,
}: {
  policy: TrustPolicyCatalogItem;
}) {
  const baseStyle = {
    background: policy.bg,
    color: policy.color,
    padding: "3px 8px",
    borderRadius: 8,
  };

  return (
    <div style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
      <AccentPill style={baseStyle} title="Требование к повторному вводу кода подтверждения.">
        Код: {policy.code_required}
      </AccentPill>
      <AccentPill style={baseStyle} title="Сколько действует доверие к устройству.">
        Срок доверия: {policy.duration}
      </AccentPill>
      <AccentPill style={baseStyle} title="Оценка риска для выбранной trust-политики.">
        Риск: {policy.risk}
      </AccentPill>
    </div>
  );
}
