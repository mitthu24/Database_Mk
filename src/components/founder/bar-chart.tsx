// A small, dependency-free SVG bar chart. No chart library needed for a
// handful of monthly/categorical bars.
export function BarChart({
  data,
  valueLabel,
}: {
  data: { label: string; value: number }[];
  valueLabel?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 480;
  const height = 160;
  const barGap = 8;
  const barWidth = data.length > 0 ? Math.max(8, width / data.length - barGap) : 0;

  return (
    <svg viewBox={`0 0 ${width} ${height + 24}`} className="w-full" role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const h = (d.value / max) * height;
        const x = i * (barWidth + barGap);
        const y = height - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={3} className="fill-accent" />
            <title>{`${d.label}: ${valueLabel ? valueLabel(d.value) : d.value}`}</title>
            <text x={x + barWidth / 2} y={height + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
