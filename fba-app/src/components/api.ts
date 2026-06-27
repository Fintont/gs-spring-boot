/** GET JSON from the market-data API, surfacing a useful error on failure. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    // Read the error body defensively: when the API server is down the dev proxy returns
    // a non-JSON (HTML) error page, so res.json() would throw and mask the real status.
    let message = `API error (${res.status} ${res.statusText})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON body — keep the status message */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
