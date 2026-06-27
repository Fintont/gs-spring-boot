import { useState } from 'react';
import { MarginCalculator } from './components/MarginCalculator';
import { ExpoImport } from './components/ExpoImport';

type Tab = 'calculator' | 'import';

export function App() {
  const [tab, setTab] = useState<Tab>('calculator');
  return (
    <div className="app">
      <header className="app__header">
        <h1>UAE FBA Finder</h1>
        <p className="app__subtitle">Module 1 · Amazon.ae product evaluation</p>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'calculator'} className={tab === 'calculator' ? 'tabs__btn tabs__btn--active' : 'tabs__btn'} onClick={() => setTab('calculator')}>
            Margin calculator
          </button>
          <button role="tab" aria-selected={tab === 'import'} className={tab === 'import' ? 'tabs__btn tabs__btn--active' : 'tabs__btn'} onClick={() => setTab('import')}>
            Expo idea-feeder
          </button>
        </nav>
      </header>
      <main>{tab === 'calculator' ? <MarginCalculator /> : <ExpoImport />}</main>
      <footer className="app__footer">
        <span>Phase 1 · offline (no API). Live market data &amp; scoring arrive in phase 2.</span>
      </footer>
    </div>
  );
}
