import Button from "./Button";
import Card from "./Card";

export type QuickActionItem = {
  key: string;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  hidden?: boolean;
};

export default function ContextQuickActions({
  title = "Быстрые действия",
  items,
}: {
  title?: string;
  items: QuickActionItem[];
}) {
  const visible = items.filter((x) => !x.hidden);
  if (!visible.length) return null;
  return (
    <Card style={{ borderColor: "rgba(80,210,200,0.35)", background: "rgba(80,210,200,0.07)" }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {visible.map((item) => (
            <Button key={item.key} size="sm" variant={item.variant || "secondary"} onClick={item.onClick}>
              {item.label}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
