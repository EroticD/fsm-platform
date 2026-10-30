export type MeterChartReading = {
  id: string;
  value: string;
  readAt: Date;
};

/**
 * Enkel, tilgjengelig SVG-linje for målerutviklingen. Diagrammet er dekorativt
 * og har en tekstlig beskrivelse; den faktiske listen med målinger står under.
 */
export default function MeterChart({
  readings,
  unit,
  label,
  emptyLabel,
  model,
}: {
  readings: MeterChartReading[];
  unit?: string | null;
  label: string;
  emptyLabel: string;
  model: string;
}) {
  const series = [...readings]
    .sort((a, b) => a.readAt.getTime() - b.readAt.getTime())
    .map((reading) => ({ ...reading, numeric: Number(reading.value) }))
    .filter((reading) => Number.isFinite(reading.numeric));

  if (series.length < 2) {
    return (
      <p className="text-xs italic text-[var(--muted,#62685f)]">{emptyLabel}</p>
    );
  }

  const width = 640;
  const height = 180;
  const padX = 28;
  const padY = 24;
  const values = series.map((reading) => reading.numeric);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const x = (index: number) =>
    padX + (index / Math.max(1, series.length - 1)) * (width - padX * 2);
  const y = (value: number) =>
    height - padY - ((value - min) / span) * (height - padY * 2);
  const points = series
    .map((reading, index) => `${x(index)},${y(reading.numeric)}`)
    .join(" ");

  const last = series[series.length - 1];

  return (
    <div
      role="img"
      aria-label={`${label} ${model}. ${last.numeric}${unit ? ` ${unit}` : ""}`}
      className="min-w-0 overflow-hidden rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="var(--line,#dedcd1)"
          strokeWidth="1"
        />
        <line
          x1={padX}
          y1={padY}
          x2={padX}
          y2={height - padY}
          stroke="var(--line,#dedcd1)"
          strokeWidth="1"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--ink,#101310)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {series.map((reading, index) => (
          <circle
            key={reading.id}
            cx={x(index)}
            cy={y(reading.numeric)}
            r="4"
            fill="var(--signal,#d8ff3e)"
            stroke="var(--ink,#101310)"
            strokeWidth="2"
          />
        ))}
        <text
          x={padX}
          y={padY - 8}
          fontSize="12"
          fill="var(--muted,#62685f)"
        >
          {max}
          {unit ? ` ${unit}` : ""}
        </text>
        <text
          x={padX}
          y={height - padY + 16}
          fontSize="12"
          fill="var(--muted,#62685f)"
        >
          {series[0].readAt.toISOString().slice(0, 10)}
        </text>
        <text
          x={width - padX}
          y={height - padY + 16}
          fontSize="12"
          textAnchor="end"
          fill="var(--muted,#62685f)"
        >
          {last.readAt.toISOString().slice(0, 10)}
        </text>
      </svg>
    </div>
  );
}
