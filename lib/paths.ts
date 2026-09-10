export function assetUrl(path: string, base = document.baseURI): string {
  // Always stay relative to the Pages project root, including /repository/.
  return new URL(
    path.startsWith('/') ? path.slice(1) : path,
    new URL('.', base),
  ).href;
}
export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error('無法讀取公開資料，請稍後重試。');
  return response.json() as Promise<T>;
}
