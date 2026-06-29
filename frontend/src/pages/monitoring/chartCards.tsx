import Card from "../../components/ui/Card";
import InteractiveLineChart from "../../components/monitoring/InteractiveLineChart";
import { highlightStyle } from "./chartStyles";
import type { HistoryPoint } from "./types";

export function SmallHistoryCard({
  title,
  points,
  color,
  highlighted,
  onZoom,
}: {
  title: string;
  points?: HistoryPoint[];
  color: string;
  highlighted?: boolean;
  onZoom?: () => void;
}) {
  const values = (points || []).map((p) => Number(p.value || 0));
  const current = values.length ? values[values.length - 1] : 0;
  const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0;

  return (
    <Card style={highlightStyle(Boolean(highlighted))} interactive={Boolean(onZoom)} onClick={onZoom}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>текущее: {current.toFixed(0)}</div>
      </div>
      {values.length < 2 ? (
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>Недостаточно данных для графика.</div>
      ) : (
        <>
          <div style={{ marginTop: 6 }}>
            <InteractiveLineChart
              points={points || []}
              color={color}
              label={title}
              minTickSpacingPx={108}
            />
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Δ: {delta >= 0 ? "+" : ""}{delta.toFixed(0)}</div>
        </>
      )}
    </Card>
  );
}

export function BigChart({
  title,
  points,
  color,
  highlighted,
}: {
  title: string;
  points?: HistoryPoint[];
  color: string;
  highlighted?: boolean;
}) {
  const values = (points || []).map((p) => Number(p.value || 0));
  const h = 180;
  if (values.length < 2) {
    return (
      <Card style={highlightStyle(Boolean(highlighted))}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 13, opacity: 0.75 }}>Недостаточно данных для графика.</div>
      </Card>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values[values.length - 1] - values[0];

  return (
    <Card style={highlightStyle(Boolean(highlighted))}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          min: {min.toFixed(0)} | max: {max.toFixed(0)} | Δ: {d >= 0 ? "+" : ""}
          {d.toFixed(0)}
        </div>
      </div>
      <InteractiveLineChart
        points={points || []}
        color={color}
        label={title}
        height={h}
        chartWidth={760}
        showYAxis
        tickCount={5}
        minTickSpacingPx={140}
      />
    </Card>
  );
}
