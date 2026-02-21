import type { EventItem } from "../../api/events";
import { eventTimestampFromMetaOrCreatedAt, formatEventMarkerLocalShort, formatEventMarkerTime } from "../../utils/eventTime";
import { buildSparkPath, computeMarkerX, monitoringRecommendation, type FocusHistoryResponse, type MonitoringErrorRow } from "../../utils/monitoringContext";
import Card from "../ui/Card";
import ContextQuickActions from "../ui/ContextQuickActions";

type Props = {
  item: EventItem;
  focus: FocusHistoryResponse | null;
  errorRows: MonitoringErrorRow[];
  rangeMinutes: number;
  onOpenFocus: () => void;
  onShowSimilar: () => void;
  onMarkHandled: () => void;
};

export default function MonitoringContextCard({
  item,
  focus,
  errorRows,
  rangeMinutes,
  onOpenFocus,
  onShowSimilar,
  onMarkHandled,
}: Props) {
  if (!focus && errorRows.length === 0) return null;

  const rec = monitoringRecommendation(item);

  return (
    <Card style={{ borderColor: "rgba(243,198,119,0.35)", background: "rgba(243,198,119,0.06)" }}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Контекст ошибок/мониторинга</div>

        <Card style={{ borderColor: "rgba(240,168,94,0.45)", background: "rgba(240,168,94,0.08)" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Рекомендация: {rec.title}</div>
            <div style={{ fontSize: 12, opacity: 0.82 }}>Почему: {rec.why}</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 12, opacity: 0.9 }}>
              {rec.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </Card>

        {focus && (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.82 }}>
              метрика: {focus.query || "focus"} • источник: {focus.source}
            </div>
            {focus.series.length >= 2 ? (
              <div style={{ display: "grid", gap: 4 }}>
                <svg width="100%" height="84" viewBox="0 0 280 84" preserveAspectRatio="none">
                  <path
                    d={buildSparkPath(
                      focus.series.map((p) => Number(p.value || 0)),
                      280,
                      84,
                    )}
                    fill="none"
                    stroke="#f0a85e"
                    strokeWidth="2"
                  />
                  {(() => {
                    const eventTsRaw = item?.meta?.detected_at_utc || item?.meta?.event_ts || item?.created_at;
                    const eventTs = eventTimestampFromMetaOrCreatedAt(item.meta || null, item.created_at);
                    const marker = eventTs ? computeMarkerX(focus.series, eventTs, 280) : null;
                    if (marker === null) return null;
                    const markerTime = formatEventMarkerTime(eventTsRaw);
                    return (
                      <>
                        <line x1={marker.x} y1={6} x2={marker.x} y2={78} stroke="#7aa6ff" strokeWidth="1.5" strokeDasharray="3 3" />
                        <circle cx={marker.x} cy={10} r={2.5} fill="#7aa6ff" />
                        {markerTime && <title>{markerTime}</title>}
                        {marker.outOfRange && (
                          <text
                            x={marker.outOfRange === "left" ? marker.x + 4 : marker.x - 4}
                            y={16}
                            textAnchor={marker.outOfRange === "left" ? "start" : "end"}
                            fill="#7aa6ff"
                            fontSize="9"
                          >
                            {marker.outOfRange === "left" ? "до окна" : "после окна"}
                          </text>
                        )}
                      </>
                    );
                  })()}
                </svg>
                {(() => {
                  const eventTsRaw = item?.meta?.detected_at_utc || item?.meta?.event_ts || item?.created_at;
                  const eventTs = eventTimestampFromMetaOrCreatedAt(item.meta || null, item.created_at);
                  const marker = eventTs ? computeMarkerX(focus.series, eventTs, 280) : null;
                  const markerTime = formatEventMarkerLocalShort(eventTsRaw);
                  if (!marker || !markerTime) return null;
                  return (
                    <div style={{ position: "relative", height: 14 }}>
                      <div
                        style={{
                          position: "absolute",
                          left: `${Math.max(0, Math.min(100, (marker.x / 280) * 100))}%`,
                          transform: "translateX(-50%)",
                          fontSize: 10,
                          opacity: 0.78,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {markerTime}
                      </div>
                    </div>
                  );
                })()}
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  Пунктирная линия — момент события; окно графика: {
                    rangeMinutes >= 10080 ? "7 дней" : rangeMinutes >= 1440 ? "24 часа" : "1 час"
                  }.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.75 }}>Недостаточно данных для графика.</div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Связанные HTTP-ошибки</div>
          {errorRows.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.75 }}>По текущему контексту ошибок не найдено.</div>
          ) : (
            errorRows.map((r, idx) => (
              <div key={`${r.labels}-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, fontSize: 12 }}>
                <div style={{ opacity: 0.85 }}>{r.labels}</div>
                <div style={{ fontWeight: 700 }}>{r.value}</div>
              </div>
            ))
          )}
        </div>

        <ContextQuickActions
          items={[
            { key: "monitoring-focus", label: "Открыть фокус в Мониторинге", variant: "primary", onClick: onOpenFocus },
            { key: "monitoring-similar", label: "Показать похожие события", variant: "secondary", onClick: onShowSimilar },
            { key: "monitoring-handled", label: "Отметить как обработанное", variant: "ghost", onClick: onMarkHandled },
          ]}
        />
      </div>
    </Card>
  );
}
