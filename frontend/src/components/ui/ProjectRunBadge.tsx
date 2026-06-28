import AccentPill from "./AccentPill";

type Props = {
  status?: string | null;
  compact?: boolean;
};

type Meta = {
  label: string;
  icon: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  hint: string;
  rowBaseBg: string;
  rowBaseBorder: string;
  rowHoverBg: string;
  rowHoverBorder: string;
  rowActiveBg: string;
  rowActiveBorder: string;
};

export function getProjectRunBadgeMeta(statusRaw?: string | null): Meta {
  const status = (statusRaw || "").toUpperCase();
  if (!status) {
    return {
      label: "Не запускался",
      icon: "!",
      tone: "warning",
      hint: "Прогонов пока нет.",
      rowBaseBg: "rgba(240,168,94,0.06)",
      rowBaseBorder: "rgba(240,168,94,0.24)",
      rowHoverBg: "rgba(240,168,94,0.13)",
      rowHoverBorder: "rgba(240,168,94,0.44)",
      rowActiveBg: "rgba(240,168,94,0.11)",
      rowActiveBorder: "rgba(240,168,94,0.37)",
    };
  }
  if (status === "RUNNING") {
    return {
      label: "Идет прогон",
      icon: "↻",
      tone: "info",
      hint: "Сканирование выполняется.",
      rowBaseBg: "rgba(120,166,255,0.05)",
      rowBaseBorder: "rgba(120,166,255,0.22)",
      rowHoverBg: "rgba(120,166,255,0.12)",
      rowHoverBorder: "rgba(120,166,255,0.46)",
      rowActiveBg: "rgba(120,166,255,0.1)",
      rowActiveBorder: "rgba(120,166,255,0.39)",
    };
  }
  if (status === "QUEUED") {
    return {
      label: "В очереди",
      icon: "•",
      tone: "info",
      hint: "Задача поставлена в очередь и ждёт свободный crawler worker.",
      rowBaseBg: "rgba(120,166,255,0.05)",
      rowBaseBorder: "rgba(120,166,255,0.22)",
      rowHoverBg: "rgba(120,166,255,0.12)",
      rowHoverBorder: "rgba(120,166,255,0.46)",
      rowActiveBg: "rgba(120,166,255,0.1)",
      rowActiveBorder: "rgba(120,166,255,0.39)",
    };
  }
  if (status === "CANCEL_REQUESTED") {
    return {
      label: "Останавливается",
      icon: "…",
      tone: "warning",
      hint: "Остановка запрошена. Crawler завершит текущий шаг и остановится.",
      rowBaseBg: "rgba(240,168,94,0.06)",
      rowBaseBorder: "rgba(240,168,94,0.24)",
      rowHoverBg: "rgba(240,168,94,0.13)",
      rowHoverBorder: "rgba(240,168,94,0.44)",
      rowActiveBg: "rgba(240,168,94,0.11)",
      rowActiveBorder: "rgba(240,168,94,0.37)",
    };
  }
  if (status === "FINISHED") {
    return {
      label: "Прогон успешен",
      icon: "✓",
      tone: "success",
      hint: "Последний прогон завершен успешно.",
      rowBaseBg: "rgba(110,199,181,0.05)",
      rowBaseBorder: "rgba(110,199,181,0.22)",
      rowHoverBg: "rgba(110,199,181,0.12)",
      rowHoverBorder: "rgba(110,199,181,0.46)",
      rowActiveBg: "rgba(110,199,181,0.1)",
      rowActiveBorder: "rgba(110,199,181,0.39)",
    };
  }
  if (status === "FAILED") {
    return {
      label: "Ошибка",
      icon: "!",
      tone: "danger",
      hint: "Последний прогон завершился ошибкой.",
      rowBaseBg: "rgba(230,127,127,0.05)",
      rowBaseBorder: "rgba(230,127,127,0.22)",
      rowHoverBg: "rgba(230,127,127,0.12)",
      rowHoverBorder: "rgba(230,127,127,0.46)",
      rowActiveBg: "rgba(230,127,127,0.1)",
      rowActiveBorder: "rgba(230,127,127,0.39)",
    };
  }
  return {
    label: "Ожидает",
    icon: "•",
    tone: "neutral",
    hint: `Текущий статус: ${status}`,
    rowBaseBg: "rgba(158,167,179,0.05)",
    rowBaseBorder: "rgba(158,167,179,0.22)",
    rowHoverBg: "rgba(158,167,179,0.12)",
    rowHoverBorder: "rgba(158,167,179,0.44)",
    rowActiveBg: "rgba(158,167,179,0.1)",
    rowActiveBorder: "rgba(158,167,179,0.37)",
  };
}

export default function ProjectRunBadge({ status, compact = false }: Props) {
  const meta = getProjectRunBadgeMeta(status);
  const isRunning = (status || "").toUpperCase() === "RUNNING";
  const compactStyle = compact
    ? {
        width: 30,
        minWidth: 30,
        height: 30,
        padding: 0,
        borderRadius: 999,
        justifyContent: "center" as const,
      }
    : {
        padding: "3px 8px",
      };
  return (
    <AccentPill
      tone={meta.tone}
      title={meta.hint}
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        whiteSpace: "nowrap",
        ...compactStyle,
      }}
    >
      {compact ? (
        isRunning ? (
          <span
            className="project-run-spinner"
            aria-label="Идет прогон"
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: "2px solid currentColor",
              borderTopColor: "transparent",
              display: "inline-block",
            }}
          />
        ) : (
          <span
            style={{
              width: 14,
              height: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              lineHeight: 1,
              fontWeight: 800,
            }}
          >
            {meta.icon}
          </span>
        )
      ) : meta.label}
    </AccentPill>
  );
}
