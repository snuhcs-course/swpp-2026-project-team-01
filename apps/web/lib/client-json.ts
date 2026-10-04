export async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error(fallback); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(fallback);
  if (!response.ok) {
    const message = (result as { error?: unknown }).error;
    throw new Error(typeof message === "string" ? message : fallback);
  }
  return result as T;
}
