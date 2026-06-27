import { useEffect, useState } from 'react';
import {
  LaunchProduct, ItemStatus, defaultChecklist, createLaunchProduct, setItem, computeProgress,
  isLaunchReady, statusOf, isApplicable,
} from '../domain/launch';

const STORAGE_KEY = 'fba.launch.v1';
const DEFS = defaultChecklist();

/** A persisted entry is only usable if it has the fields the UI/domain dereference. */
function isValidProduct(x: unknown): x is LaunchProduct {
  const p = x as LaunchProduct;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string'
    && typeof p.esmaRegulated === 'boolean' && typeof p.items === 'object' && p.items !== null;
}

function load(): LaunchProduct[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Drop anything that doesn't match the current shape (e.g. an older schema), so a
    // stale/corrupt payload can't crash computeProgress/statusOf during render.
    return Array.isArray(parsed) ? parsed.filter(isValidProduct) : [];
  } catch {
    return [];
  }
}
function save(products: LaunchProduct[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  } catch {
    /* ignore quota/availability errors */
  }
}

const now = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.round(Math.random() * 1e6)}`);

const STATUS_LABEL: Record<ItemStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done', na: 'N/A' };

export function LaunchTracker() {
  const [products, setProducts] = useState<LaunchProduct[]>(() => load());
  const [selectedId, setSelectedId] = useState<string | null>(() => products[0]?.id ?? null);
  const [draft, setDraft] = useState({ name: '', category: '', asin: '', esmaRegulated: false });

  useEffect(() => save(products), [products]);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  const addProduct = () => {
    if (!draft.name.trim()) return;
    const p = createLaunchProduct(draft, uid(), now());
    setProducts((ps) => [...ps, p]);
    setSelectedId(p.id);
    setDraft({ name: '', category: '', asin: '', esmaRegulated: false });
  };

  const update = (fn: (p: LaunchProduct) => LaunchProduct) =>
    setProducts((ps) => ps.map((p) => (p.id === selectedId ? fn(p) : p)));

  const removeProduct = (id: string) => {
    setProducts((ps) => ps.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div className="launch">
      <aside className="launch__list">
        <h2>Products</h2>
        {products.length === 0 && <p className="calc__hint">No products yet — add one to start a launch checklist.</p>}
        <ul>
          {products.map((p) => {
            const prog = computeProgress(p, DEFS);
            return (
              <li key={p.id} className={p.id === selectedId ? 'launch__item launch__item--active' : 'launch__item'} onClick={() => setSelectedId(p.id)}>
                <div className="launch__item-name">{p.name} {isLaunchReady(p, DEFS) && <span title="Launch ready">🚀</span>}</div>
                <div className="launch__item-bar"><div className="scorebar"><div className="scorebar__fill" style={{ width: `${prog.pct}%` }} /></div></div>
                <div className="launch__item-sub">{prog.done}/{prog.applicable} · {prog.pct}%{p.esmaRegulated && ' · ESMA'}</div>
              </li>
            );
          })}
        </ul>

        <fieldset className="launch__add">
          <legend>Add product</legend>
          <input placeholder="Product name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addProduct()} />
          <input placeholder="Category (optional)" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <input placeholder="ASIN (optional)" value={draft.asin} onChange={(e) => setDraft({ ...draft, asin: e.target.value })} />
          <label className="calc__check"><input type="checkbox" checked={draft.esmaRegulated} onChange={(e) => setDraft({ ...draft, esmaRegulated: e.target.checked })} /> ESMA-regulated type</label>
          <button className="btn" onClick={addProduct} disabled={!draft.name.trim()}>Add</button>
        </fieldset>
      </aside>

      <section className="launch__detail">
        {!selected ? (
          <p className="calc__hint">Select or add a product to see its launch checklist.</p>
        ) : (
          // key by product id so switching products remounts the uncontrolled note inputs
          <LaunchDetail key={selected.id} product={selected} onUpdate={update} onDelete={() => removeProduct(selected.id)} />
        )}
      </section>
    </div>
  );
}

function LaunchDetail({ product, onUpdate, onDelete }: { product: LaunchProduct; onUpdate: (fn: (p: LaunchProduct) => LaunchProduct) => void; onDelete: () => void }) {
  const prog = computeProgress(product, DEFS);
  const ready = isLaunchReady(product, DEFS);

  return (
    <div>
      <div className={`verdict ${ready ? 'verdict--pass' : 'verdict--warn'}`}>
        <span className="verdict__icon">{ready ? '🚀' : '🛠️'}</span>
        <div>
          <div className="verdict__label">{product.name}</div>
          <div className="verdict__margin">{[product.category, product.asin].filter(Boolean).join(' · ') || 'Launch checklist'}{product.esmaRegulated && ' · ESMA-regulated'}</div>
        </div>
        <div className="verdict__profit">{prog.pct}<small>%</small></div>
      </div>

      {!ready && prog.remaining.length > 0 && (
        <p className="calc__hint">Blocking launch: {prog.remaining.map((d) => d.label).join(', ')}</p>
      )}

      <ul className="checklist">
        {DEFS.map((def) => {
          const applicable = isApplicable(def, product);
          const status = statusOf(def, product);
          return (
            <li key={def.id} className={`checklist__item${def.compliance ? ' checklist__item--compliance' : ''}${!applicable ? ' checklist__item--na' : ''}`}>
              <div className="checklist__head">
                <span className="checklist__label">
                  {def.label}
                  {def.compliance && <span className="tag tag--compliance">compliance</span>}
                  {def.esmaOnly && <span className="tag tag--esma">ESMA</span>}
                </span>
                <select
                  className={`checklist__status checklist__status--${status}`}
                  value={status}
                  disabled={!applicable}
                  onChange={(e) => onUpdate((p) => setItem(p, def.id, e.target.value as ItemStatus, new Date().toISOString()))}
                >
                  {(['todo', 'in_progress', 'done'] as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  {!applicable && <option value="na">N/A</option>}
                </select>
              </div>
              <div className="checklist__desc">{def.description}{!applicable && ' (not applicable — not ESMA-regulated)'}</div>
              {applicable && (
                <input
                  className="checklist__note"
                  placeholder="Note (e.g. TRN, broker, tracking)…"
                  defaultValue={product.items[def.id]?.note ?? ''}
                  onBlur={(e) => onUpdate((p) => setItem(p, def.id, statusOf(def, p), new Date().toISOString(), e.target.value))}
                />
              )}
            </li>
          );
        })}
      </ul>

      <button className="btn btn--ghost" onClick={onDelete}>Delete product</button>
    </div>
  );
}
