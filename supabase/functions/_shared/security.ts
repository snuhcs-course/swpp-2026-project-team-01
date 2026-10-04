import { DomainError } from './errors.ts';
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(
    /=+$/,
    '',
  );
}
export async function hashToken(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  )
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hashToken(a), hashToken(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return difference === 0;
}
export async function encryptSecret(value: unknown, keyText: string): Promise<string> {
  const bytes = Uint8Array.from(atob(keyText), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new DomainError('provider_unavailable', 503);
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...ciphertext));
}
export async function decryptSecret<T>(value: string, keyText: string): Promise<T> {
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(keyText), (c) => c.charCodeAt(0)),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new DomainError('reconnect_required', 409);
  }
}
export async function jsonInput(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new DomainError('invalid_input');
  }
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new DomainError('invalid_input', 413);
      }
      chunks.push(value);
    }
  }
  try {
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const value = JSON.parse(new TextDecoder().decode(merged));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new DomainError('invalid_input');
  }
}
