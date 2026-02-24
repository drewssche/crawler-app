import { useEffect, useMemo, useRef, useState } from "react";
import { formatLocalDateTimeWithOffset } from "../../utils/datetime";
import { UI_BULLET } from "../../utils/uiText";

export type LinePoint = { ts: number; value: number };

type Props = {
  points: LinePoint[];
  color: string;
  label?: string;
  height?: number;
  chartWidth?: number;
  showYAxis?: boolean;
  tickCount?: number;
  minTickSpacingPx?: number;
  markerTs?: number | null;
  markerTimestamps?: number[];
  markerColor?: string;
  showDeltaInInfo?: boolean;
  smoothHover?: boolean;
  clickable?: boolean;
  onClick?: (point: LinePoint) => void;
};

type HoverState = {
  index: number;
  indexFloat: number;
  x: number;
  y: number;
  value: number;
  ts: number;
  deltaPrev: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function InteractiveLineChart({
  points,
  color,
  label = "Значение метрики",
  height = 84,
  chartWidth = 360,
  showYAxis = false,
  tickCount = 4,
  minTickSpacingPx = 120,
  markerTs = null,
  markerTimestamps = [],
  markerColor = "#7aa6ff",
  showDeltaInInfo = true,
  smoothHover = true,
  clickable = false,
  onClick,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const smoothRafRef = useRef<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [smoothHoverState, setSmoothHoverState] = useState<HoverState | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(chartWidth);

  const values = useMemo(() => points.map((p) => Number(p.value || 0)), [points]);
  const effectiveWidth = Math.max(220, measuredWidth || chartWidth);

  const metrics = useMemo(() => {
    if (values.length < 2) {
      return {
        min: 0,
        max: 1,
        span: 1,
        path: "",
      };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const chartInnerH = height - 16;
    const path = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * (effectiveWidth - 8) + 4;
        const y = height - 8 - ((v - min) / span) * chartInnerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    return { min, max, span, path };
  }, [effectiveWidth, height, values]);

  const yForValue = (v: number) => {
    const chartInnerH = height - 16;
    return height - 8 - ((v - metrics.min) / metrics.span) * chartInnerH;
  };

  const timeTicks = useMemo(() => {
    if (!points.length) return [] as number[];
    const adaptiveCount = Math.max(2, Math.floor(effectiveWidth / Math.max(64, minTickSpacingPx)));
    const count = Math.max(2, Math.min(tickCount, adaptiveCount));
    const minTs = points[0].ts;
    const maxTs = points[points.length - 1].ts;
    if (maxTs <= minTs) return [minTs];
    return Array.from({ length: count }).map((_, i) => minTs + ((maxTs - minTs) * i) / (count - 1));
  }, [effectiveWidth, minTickSpacingPx, points, tickCount]);

  const xForTs = useMemo(() => {
    return (ts: number): number | null => {
      if (!points.length) return null;
      const minTs = points[0].ts;
      const maxTs = points[points.length - 1].ts;
      if (!Number.isFinite(ts) || maxTs <= minTs) return null;
      const clamped = clamp(ts, minTs, maxTs);
      const ratio = (clamped - minTs) / (maxTs - minTs);
      return ratio * (effectiveWidth - 8) + 4;
    };
  }, [effectiveWidth, points]);

  useEffect(() => {
    if (!rootRef.current) return;
    const node = rootRef.current;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || chartWidth;
      setMeasuredWidth(Math.max(220, Math.round(width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [chartWidth]);

  useEffect(() => {
    if (!smoothHover) {
      setSmoothHoverState(hover);
      return;
    }
    if (!hover) {
      setSmoothHoverState(null);
      return;
    }

    if (smoothRafRef.current != null) {
      window.cancelAnimationFrame(smoothRafRef.current);
      smoothRafRef.current = null;
    }

    const target = hover;
    const animate = () => {
      setSmoothHoverState((prev) => {
        if (!prev) return target;
        const nextX = prev.x + (target.x - prev.x) * 0.34;
        const nextY = prev.y + (target.y - prev.y) * 0.34;
        const settled = Math.abs(nextX - target.x) < 0.35 && Math.abs(nextY - target.y) < 0.35;
        if (settled) return target;
        return { ...target, x: nextX, y: nextY };
      });
      smoothRafRef.current = window.requestAnimationFrame(animate);
    };

    smoothRafRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (smoothRafRef.current != null) {
        window.cancelAnimationFrame(smoothRafRef.current);
        smoothRafRef.current = null;
      }
    };
  }, [hover, smoothHover]);

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (values.length < 2) return;
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = clamp(e.clientX - rect.left, 0, rect.width);

    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      const xSvg = (px / rect.width) * effectiveWidth;
      const ratio = clamp((xSvg - 4) / (effectiveWidth - 8), 0, 1);
      const idxFloat = ratio * (values.length - 1);
      const left = Math.floor(idxFloat);
      const right = Math.min(values.length - 1, Math.ceil(idxFloat));
      const t = idxFloat - left;
      const leftValue = values[left];
      const rightValue = values[right];
      const value = leftValue + (rightValue - leftValue) * t;
      const leftTs = points[left].ts;
      const rightTs = points[right].ts;
      const ts = leftTs + (rightTs - leftTs) * t;
      const x = ratio * (effectiveWidth - 8) + 4;
      const y = yForValue(value);
      const prevIdx = Math.max(0, left - 1);
      const deltaPrev = value - values[prevIdx];

      setHover({
        index: left,
        indexFloat: idxFloat,
        x,
        y,
        value,
        ts,
        deltaPrev,
      });
    });
  };

  const handlePointerLeave = () => {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHover(null);
  };

  const handleClick = () => {
    if (!clickable || !onClick) return;
    const activeHover = smoothHover ? smoothHoverState : hover;
    if (activeHover) {
      onClick(points[activeHover.index]);
      return;
    }
    onClick(points[points.length - 1]);
  };

  const activeHover = smoothHover ? smoothHoverState : hover;

  if (values.length < 2) {
    return <div style={{ fontSize: 12, opacity: 0.75 }}>No data for chart.</div>;
  }

  return (
    <div ref={rootRef} style={{ display: "grid", gap: 4 }}>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${effectiveWidth} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        style={{ cursor: "default" }}
      >
        {showYAxis &&
          [metrics.max, metrics.min + (metrics.max - metrics.min) / 2, metrics.min].map((tick) => (
            <g key={tick}>
              <line x1={28} y1={yForValue(tick)} x2={effectiveWidth - 8} y2={yForValue(tick)} stroke="#3335" strokeWidth="1" />
              <text x={2} y={yForValue(tick) + 4} fill="#bbb" fontSize="10">
                {tick.toFixed(0)}
              </text>
            </g>
          ))}
        <path d={metrics.path} fill="none" stroke={color} strokeWidth={2.2} />

        {timeTicks.map((ts, idx) => {
          const x = xForTs(ts);
          if (x == null) return null;
          return <line key={`tick-${ts}-${idx}`} x1={x} y1={height - 8} x2={x} y2={height - 4} stroke="#a9b6cb70" strokeWidth={1} />;
        })}

        {markerTs != null &&
          (() => {
            const x = xForTs(markerTs);
            if (x == null) return null;
            return <line x1={x} y1={6} x2={x} y2={height - 6} stroke={markerColor} strokeWidth="1.5" strokeDasharray="3 3" />;
          })()}
        {markerTimestamps.map((ts, idx) => {
          const x = xForTs(ts);
          if (x == null) return null;
          return <line key={`${ts}-${idx}`} x1={x} y1={10} x2={x} y2={height - 8} stroke="#f2b36f" strokeWidth="1" strokeDasharray="2 2" />;
        })}

        {activeHover && (
          <>
            <line x1={activeHover.x} y1={6} x2={activeHover.x} y2={height - 6} stroke="#9ec2ff" strokeWidth="1.4" />
            <line x1={4} y1={activeHover.y} x2={effectiveWidth - 4} y2={activeHover.y} stroke="#9ec2ff" strokeWidth="1" strokeDasharray="2 2" />
            <circle
              cx={activeHover.x}
              cy={activeHover.y}
              r={3.4}
              fill={color}
              style={{ opacity: 1, transition: "opacity 120ms ease, r 120ms ease" }}
            />
          </>
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.74 }}>
        {timeTicks.map((ts, idx) => (
          <span key={`${ts}-${idx}`}>
            {formatLocalDateTimeWithOffset(new Date(ts * 1000), { locale: "ru-RU", includeDate: false, includeSeconds: true })}
          </span>
        ))}
      </div>
      <div style={{ minHeight: 18, fontSize: 12, opacity: activeHover ? 0.82 : 0.55, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {activeHover
          ? `${label}: ${activeHover.value.toFixed(2)}${showDeltaInInfo ? `${UI_BULLET}delta: ${activeHover.deltaPrev >= 0 ? "+" : ""}${activeHover.deltaPrev.toFixed(2)}` : ""}${UI_BULLET}Время: ${formatLocalDateTimeWithOffset(new Date(activeHover.ts * 1000), {
              locale: "ru-RU",
              includeDate: true,
              includeSeconds: true,
            })}`
          : `${label}: —${UI_BULLET}Время: —`}
      </div>
    </div>
  );
}
