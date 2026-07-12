/* Lightweight recharts stub for jsdom render tests — avoids pulling the real
 * recharts transitive graph (d3/*), which stalls vite transform under jsdom.
 * Every named export resolves to a passthrough <div> so charts render as inert
 * containers; the null-safety logic under test is unaffected. */
import * as React from "react";

const Passthrough = ({ children }: { children?: React.ReactNode }) =>
  React.createElement("div", { "data-stub": "recharts" }, children);

const handler: ProxyHandler<Record<string, unknown>> = {
  get: (target, key: string) => {
    if (key in target) return (target as any)[key];
    return Passthrough;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default new Proxy({ ResponsiveContainer: Passthrough } as any, handler);
export const ResponsiveContainer = Passthrough;
export const LineChart = Passthrough;
export const AreaChart = Passthrough;
export const BarChart = Passthrough;
export const ScatterChart = Passthrough;
export const ComposedChart = Passthrough;
export const RadarChart = Passthrough;
export const Line = Passthrough;
export const Area = Passthrough;
export const Bar = Passthrough;
export const Scatter = Passthrough;
export const Radar = Passthrough;
export const XAxis = Passthrough;
export const YAxis = Passthrough;
export const ZAxis = Passthrough;
export const CartesianGrid = Passthrough;
export const Tooltip = Passthrough;
export const Legend = Passthrough;
export const Cell = Passthrough;
export const ReferenceLine = Passthrough;
export const ReferenceArea = Passthrough;
export const PolarGrid = Passthrough;
export const PolarAngleAxis = Passthrough;
export const PolarRadiusAxis = Passthrough;
export const Label = Passthrough;
export const LabelList = Passthrough;
export const Dot = Passthrough;
