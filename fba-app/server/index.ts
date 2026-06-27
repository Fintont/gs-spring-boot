/**
 * Minimal market-data API server (zero runtime dependencies — Node's built-in http).
 *
 * Holds the provider API keys server-side so they never reach the browser, and exposes
 * the market-signal providers behind one endpoint. Run with `npm run dev:server`.
 *
 *   GET /api/health             → which providers have keys configured
 *   GET /api/signal?keyword=…&provider=mock|keepa|rainforest&marketplace=amazon.ae
 *
 * Keys come from env vars (KEEPA_API_KEY / RAINFOREST_API_KEY) — never hardcoded.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { MockMarketSignalProvider, MarketSignalProvider } from '../src/domain/signals';
import { KeepaProvider } from '../src/domain/providers/keepa';
import { RainforestProvider } from '../src/domain/providers/rainforest';
import { MockSpApiProvider, RealSpApiProvider, SpApiProvider } from '../src/domain/performance';

const PORT = Number(process.env.PORT) || 8787;

function makeProvider(name: string): MarketSignalProvider {
  switch (name) {
    case 'keepa': {
      const key = process.env.KEEPA_API_KEY;
      if (!key) throw new Error('KEEPA_API_KEY is not set');
      return new KeepaProvider(key);
    }
    case 'rainforest': {
      const key = process.env.RAINFOREST_API_KEY;
      if (!key) throw new Error('RAINFOREST_API_KEY is not set');
      return new RainforestProvider(key);
    }
    case 'mock':
    case '':
    case undefined:
      return new MockMarketSignalProvider();
    default:
      throw new Error(`Unknown provider "${name}"`);
  }
}

function makeSpApiProvider(name: string): SpApiProvider {
  if (name === 'spapi') {
    return new RealSpApiProvider({
      clientId: process.env.SPAPI_LWA_CLIENT_ID,
      clientSecret: process.env.SPAPI_LWA_CLIENT_SECRET,
      refreshToken: process.env.SPAPI_LWA_REFRESH_TOKEN,
      marketplaceId: process.env.SPAPI_MARKETPLACE_ID,
    });
  }
  return new MockSpApiProvider();
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // dev convenience; tighten for any real deployment
  });
  res.end(json);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      providers: { mock: true, keepa: !!process.env.KEEPA_API_KEY, rainforest: !!process.env.RAINFOREST_API_KEY },
      spapi: !!process.env.SPAPI_LWA_REFRESH_TOKEN,
    });
  }

  if (url.pathname === '/api/performance') {
    const providerName = url.searchParams.get('provider') ?? 'mock';
    try {
      return send(res, 200, await makeSpApiProvider(providerName).fetchPortfolio());
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : 'provider error' });
    }
  }

  if (url.pathname === '/api/signal') {
    const keyword = url.searchParams.get('keyword')?.trim();
    const providerName = url.searchParams.get('provider') ?? 'mock';
    const marketplace = url.searchParams.get('marketplace') ?? 'amazon.ae';
    if (!keyword) return send(res, 400, { error: 'keyword is required' });
    try {
      const signal = await makeProvider(providerName).fetchSignal(keyword, marketplace);
      return send(res, 200, signal);
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : 'provider error' });
    }
  }

  send(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  handle(req, res).catch((err) => send(res, 500, { error: String(err) }));
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[fba] market-data API on http://localhost:${PORT}  (providers: mock${process.env.KEEPA_API_KEY ? ', keepa' : ''}${process.env.RAINFOREST_API_KEY ? ', rainforest' : ''})`);
});
