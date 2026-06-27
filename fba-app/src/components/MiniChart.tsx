/** Tiny dependency-free SVG chart (line / area / bar). Keeps the bundle small. */

interface MiniChartProps {
  values: number[];
  labels?: string[];
  type?: 'line' | 'area' | 'bar';
  height?: number;
  color?: string;
  /** Force the y-axis to start at 0 (default true). */
  zeroBased?: boolean;
}

export function MiniChart({ values, labels, type = 'line', height = 90, color = '#2f81f7', zeroBased = true }: MiniChartProps) {
  const w = 100;
  const h = 100;
  if (values.length === 0) return <div className="chart chart--empty">no data</div>;

  const max = Math.max(...values, zeroBased ? 0 : -Infinity);
  const min = zeroBased ? Math.min(0, ...values) : Math.min(...values);
  const span = max - min || 1;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - ((v - min) / span) * h;

  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const areaPath = `M0,${h} L ${pts.replace(/ /g, ' L ')} L ${w},${h} Z`;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img">
        {/* zero baseline */}
        {min < 0 && <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="0.5" />}
        {type === 'bar'
          ? values.map((v, i) => {
              const bw = (w / values.length) * 0.7;
              return <rect key={i} x={x(i) - bw / 2} y={Math.min(y(v), y(0))} width={bw} height={Math.abs(y(v) - y(0))} fill={color} />;
            })
          : (
            <>
              {type === 'area' && <path d={areaPath} fill={color} opacity={0.18} />}
              <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </>
          )}
      </svg>
      {labels && labels.length > 0 && (
        <div className="chart__labels">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}
