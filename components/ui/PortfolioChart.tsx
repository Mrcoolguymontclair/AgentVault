import React, { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Line,
  Text as SvgText,
  Rect,
  ClipPath,
  G,
} from "react-native-svg";
import type { ChartPoint } from "@/lib/services/portfolioService";
import { Colors } from "@/constants/colors";

const CHART_HEIGHT = 140;
const PADDING = { top: 8, bottom: 28, left: 0, right: 0 };

interface Props {
  data: ChartPoint[];
  width: number;
  isPositive: boolean;
  isDark: boolean;
  loading?: boolean;
}

function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function formatAxisValue(v: number): string {
  if (Math.abs(v) >= 10000)
    return `$${(v / 1000).toFixed(0)}k`;
  if (Math.abs(v) >= 1000)
    return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function formatAxisDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PortfolioChart({ data, width, isPositive, isDark, loading }: Props) {
  const animOpacity = useRef(new Animated.Value(0)).current;
  const dataKey = data.map((d) => `${d.date}:${d.value}`).join(",");

  useEffect(() => {
    animOpacity.setValue(0);
    Animated.timing(animOpacity, {
      toValue: 1,
      duration: 500,
      delay: 80,
      useNativeDriver: true,
    }).start();
  }, [dataKey]);

  const chartColor = isPositive ? Colors.success : Colors.danger;
  const gradientId = isPositive ? "gradGreen" : "gradRed";

  const drawWidth = Math.max(width - PADDING.left - PADDING.right, 1);
  const drawHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Loading skeleton
  if (loading) {
    return (
      <View style={{ height: CHART_HEIGHT }}>
        <View
          style={{
            margin: 12,
            height: drawHeight,
            borderRadius: 8,
            backgroundColor: isDark ? Colors.dark.skeletonHighlight : Colors.light.skeletonHighlight,
            opacity: 0.6,
          }}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12 }}>
          {[60, 40, 60].map((w, i) => (
            <View
              key={i}
              style={{
                height: 10,
                width: w,
                borderRadius: 4,
                backgroundColor: isDark ? Colors.dark.skeleton : Colors.light.skeleton,
              }}
            />
          ))}
        </View>
      </View>
    );
  }

  // Empty / no data
  if (data.length < 2) {
    return (
      <View style={{ height: CHART_HEIGHT, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: isDark ? Colors.dark.textTertiary : Colors.light.textTertiary, fontSize: 13 }}>
          No chart data yet
        </Text>
      </View>
    );
  }

  // Scale data → SVG coords
  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(maxV - minV, 1);

  // Add 10% padding to y range
  const yPad = range * 0.1;
  const yMin = minV - yPad;
  const yMax = maxV + yPad;
  const yRange = yMax - yMin;

  const toX = (i: number) =>
    PADDING.left + (i / (data.length - 1)) * drawWidth;
  const toY = (v: number) =>
    PADDING.top + drawHeight - ((v - yMin) / yRange) * drawHeight;

  const pts = data.map((d, i) => ({ x: toX(i), y: toY(d.value) }));

  // Line path
  const linePath = catmullRomPath(pts);

  // Area path: line + vertical down + horizontal back
  const areaPath =
    linePath +
    ` L ${pts[pts.length - 1].x.toFixed(2)} ${(PADDING.top + drawHeight).toFixed(2)}` +
    ` L ${pts[0].x.toFixed(2)} ${(PADDING.top + drawHeight).toFixed(2)} Z`;

  // Y axis labels (3 evenly spaced)
  const yLabels = [
    { v: yMax, y: PADDING.top + 4 },
    { v: yMin + yRange / 2, y: PADDING.top + drawHeight / 2 },
    { v: yMin, y: PADDING.top + drawHeight - 4 },
  ];

  // X axis labels: first, middle, last
  const xLabelIndices = [0, Math.floor(data.length / 2), data.length - 1];

  const svgTextColor = isDark ? Colors.dark.textTertiary : Colors.light.textTertiary;

  return (
    <Animated.View style={{ height: CHART_HEIGHT, opacity: animOpacity }}>
      <Svg width={width} height={CHART_HEIGHT}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={chartColor} stopOpacity={isDark ? 0.3 : 0.2} />
            <Stop offset="100%" stopColor={chartColor} stopOpacity={0} />
          </LinearGradient>
          <ClipPath id="chartClip">
            <Rect x={0} y={0} width={width} height={CHART_HEIGHT} />
          </ClipPath>
        </Defs>

        {/* Horizontal grid lines */}
        {yLabels.map((label, i) => (
          <Line
            key={i}
            x1={PADDING.left}
            y1={label.y}
            x2={PADDING.left + drawWidth}
            y2={label.y}
            stroke={isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}
            strokeWidth={1}
            strokeDasharray="3,4"
          />
        ))}

        <G clipPath="url(#chartClip)">
          {/* Gradient area fill */}
          <Path d={areaPath} fill={`url(#${gradientId})`} />

          {/* Line */}
          <Path
            d={linePath}
            fill="none"
            stroke={chartColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Start + end dots */}
          {[pts[0], pts[pts.length - 1]].map((pt, i) => (
            <React.Fragment key={i}>
              <Rect
                x={pt.x - 3}
                y={pt.y - 3}
                width={6}
                height={6}
                rx={3}
                fill={chartColor}
              />
            </React.Fragment>
          ))}
        </G>

        {/* Y-axis labels */}
        {yLabels.map((label, i) => (
          <SvgText
            key={i}
            x={PADDING.left + 2}
            y={label.y - 2}
            fontSize={9}
            fill={svgTextColor}
          >
            {formatAxisValue(label.v)}
          </SvgText>
        ))}

        {/* X-axis labels */}
        {xLabelIndices.map((idx) => {
          const x = toX(idx);
          const isFirst = idx === 0;
          const isLast = idx === data.length - 1;
          const anchor = isFirst ? "start" : isLast ? "end" : "middle";
          return (
            <SvgText
              key={idx}
              x={x}
              y={CHART_HEIGHT - 6}
              fontSize={9}
              fill={svgTextColor}
              textAnchor={anchor}
            >
              {formatAxisDate(data[idx].date)}
            </SvgText>
          );
        })}
      </Svg>
    </Animated.View>
  );
}
