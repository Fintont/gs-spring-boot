import { useState } from 'react';
import { MockMarketSignalProvider, MarketSignal } from '../domain/signals';
import { scoreProduct, ProductScore, ScoringWeights, DEFAULT_WEIGHTS, CriterionKey } from '../domain/scorer';

const provider = new MockMarketSignalProvider();

const verdictMeta: Record<ProductScore['verdict'], { icon: string; label: string; cls: string }> = {
  go: { icon: '✅', label: 'GO', cls: 'verdict--pass' },
  watch: { icon: '⚠️', label: 'WATCH', cls: 'verdict--warn' },
  'no-go': { icon: '❌', label: 'NO-GO', cls: 'verdict--fail' },
};

const critIcon = { pass: '✅', warn: '⚠️', fail: '❌' } as const;

export function ProductScorer() {
  const [keyword, setKeyword] = useState('silicone collapsible bottle');
  const [weightKg, setWeightKg] = useState('0.2');
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [signal, setSignal] = useState<MarketSignal | null>(null);
  const [result, setResult] = useState<ProductScore | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    const sig = await provider.fetchSignal(keyword.trim());
    setSignal(sig);
    setResult(scoreProduct(sig, { weights, weightKg: parseFloat(weightKg) || undefined }));
    setLoading(false);
  };

  const reweight = (key: CriterionKey, value: number) => {
    const next = { ...weights, [key]: value };
    setWeights(next);
    if (signal) setResult(scoreProduct(signal, { weights: next, weightKg: parseFloat(weightKg) || undefined }));
  };

  const v = result ? verdictMeta[result.verdict] : null;

  return (
    <div className="scorer">
      <section className="scorer__intro">
        <h2>Product scorer</h2>
        <p>
          Enter a keyword to pull a market signal and score it against the Stage-0 criteria.
          Data here comes from the <strong>offline mock provider</strong> — swap in Keepa or
          Rainforest in phase 2. Scoring uses <strong>market signals only</strong>; your own
          sales data is firewalled out by design.
        </p>
      </section>

      <section className="scorer__controls">
        <label className="calc__field"><span>Keyword / product</span>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} style={{ width: 260, textAlign: 'left' }} />
        </label>
        <label className="calc__field"><span>Unit weight (kg)</span>
          <input type="number" step="any" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} style={{ width: 90 }} />
        </label>
        <button className="btn" onClick={run} disabled={loading}>{loading ? 'Scoring…' : 'Score'}</button>
      </section>

      {result && v && signal && (
        <section className="scorer__results">
          <div className={`verdict ${v.cls}`}>
            <span className="verdict__icon">{v.icon}</span>
            <div>
              <div className="verdict__label">{v.label}</div>
              <div className="verdict__margin">{result.keyword} · {result.marketplace} · via {result.provider}</div>
            </div>
            <div className="verdict__profit">{result.score}<small>/100</small></div>
          </div>

          <table className="breakdown">
            <thead>
              <tr><th style={{ textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '0.78rem' }}>Criterion</th><th></th><th></th><th style={{ width: 150 }}>Weight</th></tr>
            </thead>
            <tbody>
              {result.criteria.map((c) => (
                <tr key={c.key}>
                  <td>{critIcon[c.verdict]} {c.label}<div className="results-table__sub">{c.detail}</div></td>
                  <td className="breakdown__value">{Math.round(c.score * 100)}%</td>
                  <td style={{ width: 110 }}>
                    <div className="scorebar"><div className="scorebar__fill" style={{ width: `${Math.round(c.score * 100)}%` }} /></div>
                  </td>
                  <td>
                    <input className="scorer__weight" type="range" min={0} max={0.4} step={0.01}
                      value={weights[c.key]} onChange={(e) => reweight(c.key, parseFloat(e.target.value))} />
                    <span className="scorer__weightval">{weights[c.key].toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <details className="scorer__raw">
            <summary>Raw market signal (mock)</summary>
            <pre>{JSON.stringify(signal, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
