import { useMemo, useState } from 'react';
import {
  parseCandidatesCsv,
  evaluateCandidate,
  rankCandidates,
  DEFAULT_IMPORT_SETTINGS,
  ImportSettings,
  CandidateResult,
} from '../domain/discovery';
import { Verdict } from '../domain/margin';

const AED = (n: number) => `AED ${n.toFixed(2)}`;
const PCT = (n: number) => `${(n * 100).toFixed(0)}%`;

const SAMPLE_CSV = `name,category,supplier,wholesale,weight,moq,sellingPrice
Silicone collapsible bottle,Kitchen,Yiwu Hongda,2.40,0.18,500,45
Magnetic phone mount,Auto,Shenzhen Leap,1.90,0.12,1000,39
Bamboo cutlery travel set,Kitchen,Anji Green,1.30,0.15,500,35
LED desk ring light,Electronics,Foshan Bright,4.80,0.65,300,59
Cast-iron skillet 30cm,Kitchen,Hebei Forge,9.50,3.40,200,120
Reusable produce bags 9pk,Home,Nantong Eco,1.10,0.20,1000,33`;

const verdictMeta: Record<Verdict, { icon: string; label: string; cls: string }> = {
  pass: { icon: '✅', label: 'GO', cls: 'pill--pass' },
  warn: { icon: '⚠️', label: 'MARGINAL', cls: 'pill--warn' },
  fail: { icon: '❌', label: 'NO-GO', cls: 'pill--fail' },
};

export function ExpoImport() {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);

  const parsed = useMemo(() => parseCandidatesCsv(text), [text]);
  const ranked = useMemo<CandidateResult[]>(
    () => rankCandidates(parsed.candidates.map((c) => evaluateCandidate(c, settings))),
    [parsed.candidates, JSON.stringify(settings)],
  );
  const shortlist = ranked.filter((r) => r.shortlisted);

  const setNum = (key: keyof ImportSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [key]: parseFloat(e.target.value) || 0 }));

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setText);
  };

  const downloadShortlist = () => {
    const header = 'name,category,supplier,supplierPriceAed,sellingPrice,fbaFee,netProfit,netMarginPct,verdict';
    const rows = shortlist.map((r) =>
      [
        csv(r.candidate.name), csv(r.candidate.category ?? ''), csv(r.candidate.supplier ?? ''),
        r.supplierPriceAed, r.sellingPrice, r.fbaFeeAed, r.breakdown.netProfit,
        (r.breakdown.netMarginPct * 100).toFixed(1), r.breakdown.verdict,
      ].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fba-shortlist.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="expo">
      <section className="expo__intro">
        <h2>Expo idea-feeder</h2>
        <p>
          Paste or upload a candidate list exported from an expo catalogue (Canton Fair, Yiwu,
          Global Sources, HKTDC) or a supplier sheet. Each item runs through the margin engine and
          is ranked; bulky, out-of-band and thin-margin items are flagged automatically.
        </p>
        <p className="expo__schema">
          <strong>Columns:</strong> <code>name</code>, <code>cost</code>/<code>wholesale</code>/<code>price</code>,
          <code>weight</code> (required) · <code>category</code>, <code>supplier</code>, <code>sellingPrice</code>,
          <code>moq</code>, <code>freight</code> (optional). Cost is in the import currency below.
        </p>
      </section>

      <section className="expo__controls">
        <div className="expo__inputarea">
          <div className="expo__toolbar">
            <label className="btn btn--ghost">
              Upload CSV<input type="file" accept=".csv,text/csv" onChange={onFile} hidden />
            </label>
            <button className="btn btn--ghost" onClick={() => setText(SAMPLE_CSV)}>Load sample</button>
            <button className="btn btn--ghost" onClick={() => setText('')}>Clear</button>
          </div>
          <textarea
            className="expo__textarea"
            placeholder="name,cost,weight&#10;Silicone bottle,2.4,0.18"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={8}
          />
        </div>

        <fieldset className="expo__settings">
          <legend>Import assumptions</legend>
          <Mini label={`Cost currency → AED (${settings.currency})`} value={settings.fxToAed} onChange={setNum('fxToAed')} step="0.0001" />
          <Mini label="Default sell price (AED)" value={settings.defaultSellingPrice} onChange={setNum('defaultSellingPrice')} />
          <Mini label="Default freight/unit (AED)" value={settings.defaultFreightPerUnit} onChange={setNum('defaultFreightPerUnit')} />
          <Mini label="Referral %" value={settings.referralFeePct * 100} onChange={(e) => setSettings((s) => ({ ...s, referralFeePct: (parseFloat(e.target.value) || 0) / 100 }))} />
          <Mini label="Ad %" value={settings.adAllowancePct * 100} onChange={(e) => setSettings((s) => ({ ...s, adAllowancePct: (parseFloat(e.target.value) || 0) / 100 }))} />
          <Mini label="Margin floor %" value={settings.marginThresholdPct * 100} onChange={(e) => setSettings((s) => ({ ...s, marginThresholdPct: (parseFloat(e.target.value) || 0) / 100 }))} />
        </fieldset>
      </section>

      {parsed.errors.length > 0 && (
        <div className="expo__errors">
          {parsed.errors.map((er, i) => (
            <div key={i}>⚠️ {er.row === 0 ? 'Header' : `Row ${er.row}`}: {er.message}</div>
          ))}
        </div>
      )}

      {ranked.length > 0 && (
        <section className="expo__results">
          <div className="expo__summary">
            <span><strong>{ranked.length}</strong> candidates</span>
            <span className="pill pill--pass"><strong>{shortlist.length}</strong> shortlisted</span>
            <button className="btn" onClick={downloadShortlist} disabled={shortlist.length === 0}>Download shortlist CSV</button>
          </div>

          <table className="results-table">
            <thead>
              <tr>
                <th>Product</th><th>Supplier cost</th><th>Sell</th><th>FBA</th>
                <th>Profit</th><th>Margin</th><th>Verdict</th><th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const v = verdictMeta[r.breakdown.verdict];
                return (
                  <tr key={i} className={r.shortlisted ? 'results-table__shortlisted' : 'results-table__excluded'}>
                    <td>
                      <div className="results-table__name">{r.candidate.name}</div>
                      <div className="results-table__sub">{[r.candidate.category, r.candidate.supplier].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{AED(r.supplierPriceAed)}</td>
                    <td>{AED(r.sellingPrice)}{!r.priceInBand && <span className="flag-dot" title="Outside price band" />}</td>
                    <td>{AED(r.fbaFeeAed)}{r.bulky && <span className="flag-dot flag-dot--red" title="Bulky" />}</td>
                    <td className={r.breakdown.netProfit > 0 ? '' : 'neg'}>{AED(r.breakdown.netProfit)}</td>
                    <td>{PCT(r.breakdown.netMarginPct)}</td>
                    <td><span className={`pill ${v.cls}`}>{v.icon} {v.label}</span></td>
                    <td className="results-table__flags">{r.flags.join('; ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Mini(props: { label: string; value: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; step?: string }) {
  return (
    <label className="expo__mini">
      <span>{props.label}</span>
      <input type="number" step={props.step ?? 'any'} value={Number.isFinite(props.value) ? props.value : ''} onChange={props.onChange} />
    </label>
  );
}

function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
