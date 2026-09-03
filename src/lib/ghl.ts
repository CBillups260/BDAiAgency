export interface GhlAccountRow {
  id: string;
  name: string;
  platform?: string;
}

/**
 * Normalize the connected-channel list out of `/api/ghl/accounts`. HighLevel has
 * shipped the payload as `results.accounts`, `results.data`, and a bare array at
 * different times, so probe each shape rather than trusting one.
 */
export function extractGhlAccounts(data: unknown): GhlAccountRow[] {
  const d = data as Record<string, unknown> | null | undefined;
  const results = (d?.results ?? d) as Record<string, unknown> | undefined;
  const raw = (results?.accounts ?? results?.data) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.accounts;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const a = item as Record<string, unknown>;
      const id = String(a.id ?? a._id ?? "").trim();
      const name = String(a.name ?? a.accountName ?? "Connected account");
      const platform = typeof a.platform === "string" ? a.platform : undefined;
      return { id, name, platform };
    })
    .filter((row) => row.id.length > 0);
}
