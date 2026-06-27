import { useMemo, useState } from 'react';
import { computeMargin, DEFAULT_INPUTS, MarginInputs, VatTreatment, Verdict } from '../domain/margin';
import { estimateFbaFee } from '../domain/fees';

const AED = (n: number) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 2 }).format(n);
const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;

interface FormState {
  sellingPrice: string;
  supplierPrice: string;
  freightPerUnit: string;
  weightKg: string;
  fbaFee: string;
  fbaAuto: boolean;
  referralFeePct: string;
  vatRatePct: string;
  adAllowancePct: string;
  vatTreatment: VatTreatment;
  marginThresholdPct: string;
}

const INITIAL: FormState = {
  sellingPrice: '49',
  supplierPrice: '9',
  freightPerUnit: '3',
  weightKg: '0.4',
  fbaFee: '11',
  fbaAuto: true,
  referralFeePct: '15',
  vatRatePct: '5',
  adAllowancePct: '10',
  vatTreatment: 'inclusive',
  marginThresholdPct: '30',
};

const num = (s: string) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

const verdictMeta: Record<Verdict, { icon: string; label: string; className: string }> = {
  pass: { icon: '✅', label: 'GO', className: 'verdict--pass' },
  warn: { icon: '⚠️', label: 'MARGINAL', className: 'verdict--warn' },
  fail: { icon: '❌', label: 'NO-GO', className: 'verdict--fail' },
};

export function MarginCalculator() {
  const [form, setForm] = useState<FormState>(INITIAL);

  const fbaEstimate = useMemo(() => estimateFbaFee(num(form.weightKg)), [form.weightKg]);
  const effectiveFbaFee = form.fbaAuto ? fbaEstimate.feeAed : num(form.fbaFee);

  const inputs: MarginInputs = {
    sellingPrice: num(form.sellingPrice),
    supplierPrice: num(form.supplierPrice),
    freightPerUnit: num(form.freightPerUnit),
    fbaFee: effectiveFbaFee,
    referralFeePct: num(form.referralFeePct) / 100,
    vatRatePct: num(form.vatRatePct) / 100,
    adAllowancePct: num(form.adAllowancePct) / 100,
    vatTreatment: form.vatTreatment,
    marginThresholdPct: num(form.marginThresholdPct) / 100 || DEFAULT_INPUTS.marginThresholdPct,
  };

  const b = useMemo(() => computeMargin(inputs), [JSON.stringify(inputs)]);
  const v = verdictMeta[b.verdict];

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const priceInBand = inputs.sellingPrice >= 30 && inputs.sellingPrice <= 60;

  return (
    <div className="calc">
      <section className="calc__inputs" aria-label="Inputs">
        <h2>Inputs</h2>

        <fieldset>
          <legend>Pricing &amp; product (AED)</legend>
          <Field label="Selling price (VAT-incl.)" value={form.sellingPrice} onChange={set('sellingPrice')} />
          <Field label="Supplier price / unit" value={form.supplierPrice} onChange={set('supplierPrice')} />
          <Field label="Freight + import / unit" value={form.freightPerUnit} onChange={set('freightPerUnit')} />
          <Field label="Unit weight (kg)" value={form.weightKg} onChange={set('weightKg')} />
        </fieldset>

        <fieldset>
          <legend>FBA fulfilment fee</legend>
          <label className="calc__check">
            <input type="checkbox" checked={form.fbaAuto} onChange={set('fbaAuto')} />
            Auto-estimate from weight ({AED(fbaEstimate.feeAed)} — {fbaEstimate.tier.label})
          </label>
          {!form.fbaAuto && <Field label="FBA fee / unit (AED)" value={form.fbaFee} onChange={set('fbaFee')} />}
          <p className="calc__hint">{fbaEstimate.disclaimer}</p>
        </fieldset>

        <fieldset>
          <legend>Rates (%)</legend>
          <Field label="Referral fee" value={form.referralFeePct} onChange={set('referralFeePct')} />
          <Field label="VAT" value={form.vatRatePct} onChange={set('vatRatePct')} />
          <Field label="Ad allowance (TACoS)" value={form.adAllowancePct} onChange={set('adAllowancePct')} />
          <Field label="Min margin threshold" value={form.marginThresholdPct} onChange={set('marginThresholdPct')} />
          <label className="calc__field">
            <span>VAT treatment</span>
            <select value={form.vatTreatment} onChange={set('vatTreatment')}>
              <option value="inclusive">Pass-through (VAT-registered)</option>
              <option value="addedCost">Absorb as cost (conservative)</option>
            </select>
          </label>
        </fieldset>
      </section>

      <section className="calc__results" aria-label="Results">
        <div className={`verdict ${v.className}`}>
          <span className="verdict__icon">{v.icon}</span>
          <div>
            <div className="verdict__label">{v.label}</div>
            <div className="verdict__margin">{PCT(b.netMarginPct)} net margin</div>
          </div>
          <div className="verdict__profit">{AED(b.netProfit)}<small>/unit</small></div>
        </div>

        <ul className="criteria">
          <Criterion ok={b.netMarginPct >= inputs.marginThresholdPct}
            label={`Margin ≥ ${PCT(inputs.marginThresholdPct)}`} detail={PCT(b.netMarginPct)} />
          <Criterion ok={priceInBand} warn={!priceInBand}
            label="Price band fit (AED 30–60)" detail={AED(inputs.sellingPrice)} />
          <Criterion ok={!fbaEstimate.bulky} warn={fbaEstimate.bulky}
            label="Weight/size class" detail={fbaEstimate.bulky ? 'Heavy/bulky → high FBA fee' : fbaEstimate.tier.label} />
          <Criterion ok={b.netProfit > 0} label="Profitable per unit" detail={AED(b.netProfit)} />
        </ul>

        <table className="breakdown">
          <tbody>
            <Row label="Selling price (VAT-incl.)" value={AED(b.sellingPrice)} />
            <Row label="– VAT" value={AED(b.vat)} muted note={inputs.vatTreatment === 'inclusive' ? 'remitted to FTA' : 'absorbed'} />
            <Row label="Item price (ex-VAT)" value={AED(b.itemPriceExVat)} strong />
            <Row label="– Referral fee" value={AED(b.referralFee)} muted />
            <Row label="– FBA fee" value={AED(b.fbaFee)} muted />
            <Row label="– Ad allowance" value={AED(b.adCost)} muted />
            <Row label="– Landed cost (supplier + freight)" value={AED(b.landedCost)} muted />
            <Row label="Net profit / unit" value={AED(b.netProfit)} strong />
            <Row label="Net margin" value={PCT(b.netMarginPct)} />
            <Row label="ROI on landed cost" value={PCT(b.roiPct)} />
            <Row label="Break-even price (VAT-incl.)" value={AED(b.breakEvenSellingPrice)} />
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="calc__field">
      <span>{props.label}</span>
      <input type="number" inputMode="decimal" step="any" value={props.value} onChange={props.onChange} />
    </label>
  );
}

function Criterion(props: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  const icon = props.ok ? '✅' : props.warn ? '⚠️' : '❌';
  return (
    <li className="criteria__item">
      <span className="criteria__icon">{icon}</span>
      <span className="criteria__label">{props.label}</span>
      <span className="criteria__detail">{props.detail}</span>
    </li>
  );
}

function Row(props: { label: string; value: string; muted?: boolean; strong?: boolean; note?: string }) {
  return (
    <tr className={props.strong ? 'breakdown__strong' : props.muted ? 'breakdown__muted' : ''}>
      <td>{props.label}{props.note && <em className="breakdown__note"> ({props.note})</em>}</td>
      <td className="breakdown__value">{props.value}</td>
    </tr>
  );
}
