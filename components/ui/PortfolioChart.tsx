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
  spyData?: ChartPoint[]; // normalized % overlay (0-based)
  showSpy?: boolean;
}

interface MultiLineProps {
  lines: { id: string; label: string; data: ChartPoint[]; color: string }[];
  width: number;
  isDark: boolean;
}

function formatAxisPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function MultiLineChart({ lines, width, isDark }: MultiLineProps) {
  const validLines = lines.filter((l) => l.data.length >= 2);
  if (validLines.length === 0) {
    return (
      <View style={{ height: CHART_HEIGHT, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: isDark ? Colors.dark.textTertiary : Colors.light.textTertiary, fontSize: 13 }}>
          Not enough data yet
        </Text>
      </View>
    );
  }

  const drawWidth = Math.max(width, 1);
  const drawHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Collect all values for y-range
  const allVals = validLines.flatMap((l) => l.data.map((d) => d.value));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const yPad = Math.max((maxV - minV) * 0.1, 1);
  const yMin = minV - yPad;
  const yMax = maxV + yPad;
  const yRange = yMax - yMin;

  const toY = (v: number) => PADDING.top + drawHeight - ((v - yMin) / yRange) * drawHeight;

  const svgTextColor = isDark ? Colors.dark.textTertiary : Colors.light.textTertiary;

  return (
    <View style={{ height: CHART_HEIGHT }}>
      <Svg width={width} height={CHART_HEIGHT}>
        {validLines.map((line) => {
          const pts = line.data.map((d, i) => ({
            x: PADDING.left + (i / (line.data.length - 1)) * drawWidth,
            y: toY(d.value),
          }));
          return (
            <Path
              key={line.id}
              d={catmullRomPath(pts)}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}
        {/* Y midline */}
        <SvgText x={2} y={toY((yMin + yMax) / 2) - 2} fontSize={9} fill={svgTextColor}>
          {formatAxisValue((yMin + yMax) / 2)}
        </SvgText>
      </Svg>
      {/* Legend */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 4, paddingTop: 4 }}>
        {validLines.map((line) => (
          <View key={line.id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: line.color }} />
            <Text style={{ color: svgTextColor, fontSize: 10 }} numberOfLines={1}>{line.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
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

export function PortfolioChart({ data, width, isPositive, isDark, loading, spyData, showSpy }: Props) {
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

  // When SPY overlay is active, switch to % mode — normalize both lines to 0-based %
  const activeSpyData = showSpy && spyData && spyData.length >= 2 ? spyData : null;

  // Normalize portfolio to % from first point (for SPY overlay mode)
  const portfolioNorm: ChartPoint[] = activeSpyData
    ? (() => {
        const base = data[0].value;
        return data.map((d) => ({ date: d.date, value: ((d.value - base) / Math.abs(base || 1)) * 100 }));
      })()
    : data;

  // Scale data → SVG coords
  const allValues = [
    ...portfolioNorm.map((d) => d.value),
    ...(activeSpyData ?? []).map((d) => d.value),
  ];
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = Math.max(maxV - minV, 1);

  // Add 10% padding to y range
  const yPad = range * 0.1;
  const yMin = minV - yPad;
  const yMax = maxV + yPad;
  const yRange = yMax - yMin;

  const toX = (i: number, len: number) =>
    PADDING.left + (i / (len - 1)) * drawWidth;
  const toY = (v: number) =>
    PADDING.top + drawHeight - ((v - yMin) / yRange) * drawHeight;

  const pts = portfolioNorm.map((d, i) => ({ x: toX(i, portfolioNorm.length), y: toY(d.value) }));

  // Line path
  const linePath = catmullRomPath(pts);

  // Area path: line + vertical down + horizontal back
  const areaPath =
    linePath +
    ` L ${pts[pts.length - 1].x.toFixed(2)} ${(PADDING.top + drawHeight).toFixed(2)}` +
    ` L ${pts[0].x.toFixed(2)} ${(PADDING.top + drawHeight).toFixed(2)} Z`;

  // SPY overlay path
  const spyPts = activeSpyData
    ? activeSpyData.map((d, i) => ({ x: toX(i, activeSpyData.length), y: toY(d.value) }))
    : null;
  const spyLinePath = spyPts ? catmullRomPath(spyPts) : null;

  // Y axis labels (3 evenly spaced) — % mode when SPY active
  const yLabels = activeSpyData
    ? [
        { v: yMax, y: PADDING.top + 4, label: formatAxisPct(yMax) },
        { v: yMin + yRange / 2, y: PADDING.top + drawHeight / 2, label: formatAxisPct(yMin + yRange / 2) },
        { v: yMin, y: PADDING.top + drawHeight - 4, label: formatAxisPct(yMin) },
      ]
    : [
        { v: yMax, y: PADDING.top + 4, label: formatAxisValue(yMax) },
        { v: yMin + yRange / 2, y: PADDING.top + drawHeight / 2, label: formatAxisValue(yMin + yRange / 2) },
        { v: yMin, y: PADDING.top + drawHeight - 4, label: formatAxisValue(yMin) },
      ];

  // X axis labels: first, middle, last
  const xLabelIndices = [0, Math.floor(portfolioNorm.length / 2), portfolioNorm.length - 1];

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
            <React.Fragment key={`dot-${i}`}>
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

        {/* SPY overlay — dashed gray line */}
        {spyLinePath && (
          <Path
            d={spyLinePath}
            fill="none"
            stroke={isDark ? "rgba(200,200,200,0.5)" : "rgba(100,100,100,0.4)"}
            strokeWidth={1.5}
            strokeDasharray="5,4"
            strokeLinecap="round"
          />
        )}

        {/* Y-axis labels */}
        {yLabels.map((label, i) => (
          <SvgText
            key={`ylabel-${i}`}
            x={PADDING.left + 2}
            y={label.y - 2}
            fontSize={9}
            fill={svgTextColor}
          >
            {label.label}
          </SvgText>
        ))}

        {/* X-axis labels */}
        {xLabelIndices.map((idx, i) => {
          const x = toX(idx, portfolioNorm.length);
          const isFirst = i === 0;
          const isLast = i === xLabelIndices.length - 1;
          const anchor = isFirst ? "start" : isLast ? "end" : "middle";
          return (
            <SvgText
              key={`x-${i}`}
              x={x}
              y={CHART_HEIGHT - 6}
              fontSize={9}
              fill={svgTextColor}
              textAnchor={anchor}
            >
              {formatAxisDate(portfolioNorm[idx].date)}
            </SvgText>
          );
        })}
      </Svg>
    </Animated.View>
  );
}
