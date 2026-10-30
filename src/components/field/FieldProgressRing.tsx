/**
 * Informasjonsring for posisjonen i dagens jobbrekke – ikke en fullføringsgrad.
 * Ringen viser hvor langt ned i dagens tildelte jobber montøren er, med samme
 * lime signalflate som resten av feltportalen.
 */
export default function FieldProgressRing({
  current,
  total,
  label,
  className = "",
}: {
  current: number;
  total: number;
  /** Tilgjengelig navn, for eksempel «Jobb 1 av 3». */
  label: string;
  className?: string;
}) {
  const size = 52;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = Math.max(0, total);
  const safeCurrent = Math.min(Math.max(0, current), safeTotal);
  const ratio = safeTotal > 0 ? safeCurrent / safeTotal : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className={`shrink-0 ${className}`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#2a3328"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--signal)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--paper)"
        fontSize="10"
        fontWeight="800"
        letterSpacing="-0.02em"
      >
        {safeCurrent}/{safeTotal}
      </text>
    </svg>
  );
}
