import React from "react";
import Svg, { Path } from "react-native-svg";

interface Props {
  prices: number[];
  width?: number;
  height?: number;
  color: string;
  strokeWidth?: number;
}

export function Sparkline({ prices, width = 64, height = 28, color, strokeWidth = 1.5 }: Props) {
  const filtered = prices.filter((p) => isFinite(p) && p > 0);

  if (filtered.length < 2) {
    const y = height / 2;
    return (
      <Svg width={width} height={height}>
        <Path
          d={`M 0 ${y} L ${width} ${y}`}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeOpacity={0.4}
          strokeDasharray="3,3"
        />
      </Svg>
    );
  }

  const minP = Math.min(...filtered);
  const maxP = Math.max(...filtered);
  const range = Math.max(maxP - minP, maxP * 0.001, 0.01);
  const pad = 2;

  const toX = (i: number) => pad + (i / (filtered.length - 1)) * (width - pad * 2);
  const toY = (v: number) => pad + (height - pad * 2) * (1 - (v - minP) / range);

  const pts = filtered.map((p, i) => ({ x: toX(i), y: toY(p) }));

  // Cardinal spline for smooth curve
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return (
    <Svg width={width} height={height}>
      <Path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
