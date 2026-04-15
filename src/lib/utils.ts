import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Go High Level sub-account (location) id — prefers CRM field, then legacy metadata. */
export function getGhlLocationId(
  account:
    | {
        ghlLocationId?: string | null;
        metadata?: Record<string, unknown> | null;
      }
    | null
    | undefined
): string {
  if (!account) return "";
  const top = typeof account.ghlLocationId === "string" ? account.ghlLocationId.trim() : "";
  if (top) return top;
  const m = account.metadata;
  if (!m || typeof m !== "object") return "";
  const ghl = m.ghl as Record<string, unknown> | undefined;
  const fromNested = ghl && typeof ghl.locationId === "string" ? ghl.locationId.trim() : "";
  if (fromNested) return fromNested;
  const legacy = typeof m.ghlLocationId === "string" ? m.ghlLocationId.trim() : "";
  return legacy || "";
}

/** Sub-account Private Integration token saved on the account (optional; overrides env map / global). */
export function getGhlPrivateIntegrationToken(
  account:
    | {
        ghlPrivateIntegrationToken?: string | null;
        metadata?: Record<string, unknown> | null;
      }
    | null
    | undefined
): string {
  if (!account) return "";
  const top =
    typeof account.ghlPrivateIntegrationToken === "string" ? account.ghlPrivateIntegrationToken.trim() : "";
  if (top) return top;
  const m = account.metadata;
  if (!m || typeof m !== "object") return "";
  const ghl = m.ghl as Record<string, unknown> | undefined;
  const nested =
    ghl && typeof ghl.privateIntegrationToken === "string" ? ghl.privateIntegrationToken.trim() : "";
  return nested || "";
}
