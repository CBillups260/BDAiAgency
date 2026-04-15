export const APP_ROLES = {
  ADMIN: "admin",
  TEAM_MEMBER: "team_member",
} as const;

export type AppUserRole = (typeof APP_ROLES)[keyof typeof APP_ROLES];

export function isAppUserRole(value: unknown): value is AppUserRole {
  return value === APP_ROLES.ADMIN || value === APP_ROLES.TEAM_MEMBER;
}

/** Accepts Firestore values like "Admin" or "team member" from the console. */
export function normalizeAppUserRole(value: unknown): AppUserRole | null {
  if (typeof value !== "string") return null;
  const r = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (r === "admin") return APP_ROLES.ADMIN;
  if (r === "team_member") return APP_ROLES.TEAM_MEMBER;
  return null;
}
