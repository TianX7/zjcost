import { useId } from "react";

interface RingGaugeProps {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
}

/** 环形仪表：深色分段刻度底环 + 发光进度弧 + 居中数值 + 下方标签 */
export default function RingGauge({
  value,
  max,
  label,
  unit,
  color = "#4dd4ff",
  size = 112,
}: RingGaugeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const dim = Math.max(72, size);
  const stroke = Math.max(6, Math.round(dim * 0.07));
  const radius = dim / 2 - stroke / 2 - 6;
  const circumference = 2 * Math.PI * radius;
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, safeValue / safeMax));
  const arc = Number((circumference * ratio).toFixed(2));
  const center = dim / 2;
  const valueSize = Math.round(dim * 0.19);
  const unitSize = Math.max(9, Math.round(dim * 0.092));
  const labelSize = Math.max(10, Math.round(dim * 0.098));
  const display = safeValue.toLocaleString("zh-CN", {
    maximumFractionDigits: Math.abs(safeValue) < 100 ? 1 : 0,
  });
  const tickGap = Math.max(3, circumference / 56 - 1);

  return (
    <svg
      className="ring-gauge"
      width="100%"
      viewBox={`0 0 ${dim} ${dim + 22}`}
      role="img"
      aria-label={`${label} ${display}${unit ?? ""}`}
    >
      <defs>
        <linearGradient id={`ring-arc-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
        <filter id={`ring-glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="ringBlur" />
          <feMerge>
            <feMergeNode in="ringBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(77, 212, 255, 0.08)" strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="rgba(127, 166, 201, 0.42)"
        strokeWidth={2}
        strokeDasharray={`1 ${tickGap}`}
        opacity={0.9}
      />
      <circle
        className="ring-gauge-arc"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={`url(#ring-arc-${uid})`}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${arc} ${circumference}`}
        transform={`rotate(-90 ${center} ${center})`}
        filter={`url(#ring-glow-${uid})`}
      />

      <text x={center} y={center + valueSize * 0.36} textAnchor="middle">
        <tspan fontSize={valueSize} fontWeight={700} fill={color} fontFamily="inherit">
          {display}
        </tspan>
        {unit && (
          <tspan dx={2} fontSize={unitSize} fill="var(--screen-muted)" fontFamily="inherit">
            {unit}
          </tspan>
        )}
      </text>
      <text
        x={center}
        y={dim + 15}
        textAnchor="middle"
        fontSize={labelSize}
        fill="var(--screen-muted)"
        letterSpacing="0.06em"
      >
        {label}
      </text>
    </svg>
  );
}
