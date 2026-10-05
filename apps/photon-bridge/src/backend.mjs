const JSON_HEADERS = { 'content-type': 'application/json' };

export class BackendError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

export function createBackendClient({ baseUrl, serviceToken, timeoutMs = 8_000, fetcher = fetch }) {
  async function request(path, body) {
    const base = new URL(baseUrl);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const response = await fetcher(new URL(path.replace(/^\//u, ''), base), {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BackendError(data?.error ?? `backend_${response.status}`, response.status);
    }
    return data;
  }

  return Object.freeze({
    resume: () => request('/internal/setup/imessage/resume', {}),
    inbound: (event) => request('/internal/setup/imessage/inbound', event),
    checkpoint: (sequence, disposition) =>
      request('/internal/setup/imessage/checkpoint', { sequence, disposition }),
    claimOutbound: () => request('/internal/setup/imessage/outbound/claim', {}),
    authorizeOutbound: (intentId) =>
      request('/internal/setup/imessage/outbound/authorize', { intentId }),
    recordOutcome: (outcome) =>
      request('/internal/setup/imessage/outbound/outcome', outcome),
  });
}
