import { MarginCalculator } from './components/MarginCalculator';

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>UAE FBA Finder</h1>
        <p className="app__subtitle">Landed-cost &amp; margin calculator · Amazon.ae</p>
      </header>
      <main>
        <MarginCalculator />
      </main>
      <footer className="app__footer">
        <span>Module 1 · Step 1 of the build. Scorer and operations tracker come next.</span>
      </footer>
    </div>
  );
}
