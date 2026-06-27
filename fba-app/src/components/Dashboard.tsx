import { useEffect, useRef, useState } from 'react';
import {
  MockSpApiProvider, ProductPerformance, computeSummary, marginOverTime, burnDown, reorderAlerts,
} from '../domain/performance';
import { MiniChart } from './MiniChart';
import { fetchJson } from './api';

const mock = new MockSpApiProvider();
type Source = 'mock' | 'spapi';

const AED = (n: number) => `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;
const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;
const last = <T,>(a: T[]): T | undefined => a[a.length - 1];

async function loadPortfolio(source: Source): Promise<ProductPerformance[]> {
  if (source === 'mock') return mock.fetchPortfolio();
  return fetchJson<ProductPerformance[]>(`/api/performance?provider=${source}`);
}

export function Dashboard() {
  const [source, setSource] = useState<Source>('mock');
  const [portfolio, setPortfolio] = useState<ProductPerformance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const load = (s: Source) => {
    const id = ++reqId.current; // ignore out-of-order responses when switching source
    setLoading(true);
    setError(null);
    loadPortfolio(s)
      .then((p) => { if (id === reqId.current) setPortfolio(p); })
      .catch((e) => { if (id === reqId.current) { setError(e instanceof Error ? e.message : 'Failed to load'); setPortfolio([]); } })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  };

  useEffect(() => load('mock'), []);

  const alerts = reorderAlerts(portfolio);

  return (
    <div className="dash">
      <section className="scorer__controls">
        <label className="calc__field"><span>Data source</span>
          <select value={source} onChange={(e) => { const s = e.target.value as Source; setSource(s); load(s); }}>
            <option value="mock">Mock (offline)</option>
            <option value="spapi">Amazon SP-API (needs credentials + server)</option>
          </select>
        </label>
        <button className="btn btn--ghost" onClick={() => load(source)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <span className="calc__hint" style={{ margin: 0 }}>Own-sales plane · firewalled from Module 1 scoring</span>
      </section>

      {error && <div className="expo__errors">⚠️ {error}{source === 'spapi' && ' — set SPAPI_LWA_* and run npm run dev:server.'}</div>}

      {alerts.length > 0 && (
        <div className="dash__alerts">
          <strong>🔔 Reorder needed:</strong> {alerts.map((a) => `${a.product.name} (${a.summary.daysOfCover}d cover, ${a.product.inventory} left)`).join(' · ')}
        </div>
      )}

      <div className="dash__grid">
        {portfolio.map((p) => <ProductCard key={p.asin} product={p} />)}
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: ProductPerformance }) {
  const s = computeSummary(product);
  const margins = marginOverTime(product);
  const burn = burnDown(product);

  return (
    <div className="dash__card">
      <div className="dash__card-head">
        <div>
          <div className="dash__card-name">{product.name}</div>
          <div className="results-table__sub">{product.asin}</div>
        </div>
        {s.reorderNeeded && <span className="pill pill--warn">🔔 reorder</span>}
      </div>

      <div className="dash__kpis">
        <Kpi label="Revenue" value={AED(s.revenueAed)} />
        <Kpi label="Units" value={String(s.units)} />
        <Kpi label="ACoS" value={PCT(s.acos)} warn={s.acos > 0.25} />
        <Kpi label="Net profit" value={AED(s.netProfitAed)} />
        <Kpi label="Margin" value={PCT(s.netMarginPct)} warn={s.netMarginPct < 0.2} />
        <Kpi label="Profit/unit" value={AED(s.profitPerUnitAed)} />
        <Kpi label="Inventory" value={String(s.inventory)} />
        <Kpi label="Days cover" value={Number.isFinite(s.daysOfCover) ? `${s.daysOfCover}d` : '∞'} warn={s.reorderNeeded} />
      </div>

      <div className="dash__charts">
        <Chart title="Sales (units/day)" >
          <MiniChart type="bar" values={product.series.map((x) => x.units)} labels={[product.series[0]?.date.slice(5), last(product.series)?.date.slice(5) ?? '']} color="#2f81f7" />
        </Chart>
        <Chart title="Inventory burn-down">
          <MiniChart type="area" values={burn.map((b) => b.units)} labels={['now', `+${last(burn)?.day}d`]} color="#d29922" />
        </Chart>
        <Chart title="Net margin over time">
          <MiniChart type="line" values={margins.map((m) => m.netMarginPct)} labels={[margins[0]?.date.slice(5), last(margins)?.date.slice(5) ?? '']} color="#2ea043" zeroBased={false} />
        </Chart>
      </div>
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`kpi${warn ? ' kpi--warn' : ''}`}>
      <div className="kpi__value">{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  );
}

function Chart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dash__chart">
      <div className="dash__chart-title">{title}</div>
      {children}
    </div>
  );
}
