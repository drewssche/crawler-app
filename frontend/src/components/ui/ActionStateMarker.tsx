type Tone = "info" | "warning" | "danger";

type Props = {
  icon: string;
  tone?: Tone;
  title?: string;
};

function toneStyle(tone: Tone) {
  if (tone === "danger") {
    return {
      border: "1px solid rgba(255,120,136,0.66)",
      background: "rgba(110,30,42,0.42)",
      color: "#ffe4e8",
    };
  }
  if (tone === "warning") {
    return {
      border: "1px solid rgba(243,198,119,0.62)",
      background: "rgba(243,198,119,0.16)",
      color: "#ffe3af",
    };
  }
  return {
    border: "1px solid rgba(130,176,255,0.6)",
    background: "rgba(106,160,255,0.16)",
    color: "#e6efff",
  };
}

export default function ActionStateMarker({ icon, tone = "info", title }: Props) {
  const palette = toneStyle(tone);
  return (
    <div
      title={title}
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: 12,
        ...palette,
      }}
    >
      {icon}
    </div>
  );
}

