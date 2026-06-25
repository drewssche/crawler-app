type StructureStatus = "unchanged" | "changed" | "added" | "deleted" | "redirect" | "error";

function meta(status: StructureStatus): { icon: string; color: string; label: string } {
  if (status === "changed") return { icon: "✦", color: "#f0c36a", label: "Изменено" };
  if (status === "added") return { icon: "+", color: "#6fc6ff", label: "Новая страница" };
  if (status === "deleted") return { icon: "−", color: "#ff8c9a", label: "Удалено" };
  if (status === "redirect") return { icon: "↪", color: "#f0c36a", label: "Перенаправление" };
  if (status === "error") return { icon: "!", color: "#ff6d6d", label: "Ошибка" };
  return { icon: "•", color: "rgba(210,218,232,0.55)", label: "Без изменений" };
}

export default function StructureStatusIcon({
  status,
  title,
  size = 16,
}: {
  status: StructureStatus;
  title?: string;
  size?: number;
}) {
  const m = meta(status);
  return (
    <span
      title={title || m.label}
      aria-label={title || m.label}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${m.color}`,
        color: m.color,
        background: `${m.color}22`,
        fontSize: size <= 14 ? 10 : 11,
        lineHeight: 1,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {m.icon}
    </span>
  );
}
