// The workspace's deployment settings from qyvr's admin page (M14.2, AD-13 "administration has one
// home"): signups, user search, site name, announcement, banner and accent color, changed through
// upstream's own admin API by the adapter, as the admin's agent session, so the workshop decides as it
// would for the admin in person. The `Company` checks the role first; this module checks the shape
// with upstream's own limits (the contract suite holds them equal to the pinned api.ts) so a bad value
// is refused with a code before the workshop is asked. The answer is always the workshop's read-back.
import { BANNER_COLORS, type ActingAs, type BannerColor, type WorkspaceSettings, type WorkspaceSettingsAdapter } from "../workspace/adapters.ts";

/** Upstream's `MAX_SITE_NAME_LENGTH` and `MAX_ANNOUNCEMENT_LENGTH` (workshop-shared api.ts). */
export const MAX_SITE_NAME_LENGTH = 40;
export const MAX_ANNOUNCEMENT_LENGTH = 2000;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type Refusal = { ok: false; code: string; reason: string };
export type SettingsResult = { ok: true; settings: WorkspaceSettings } | Refusal;

const invalid = (reason: string): Refusal => ({ ok: false, code: "WORKSPACE_SETTING_INVALID", reason });

/** The settings a request names, each checked; anything else in the body is refused, not ignored. */
export function checkSettingsPatch(input: unknown): { ok: true; patch: Partial<WorkspaceSettings> } | Refusal {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("send the settings to change as an object");
  const i = input as Record<string, unknown>;
  const patch: Partial<WorkspaceSettings> = {};
  for (const key of Object.keys(i)) {
    const v = i[key];
    if (key === "signupsEnabled" || key === "userSearchEnabled") {
      if (typeof v !== "boolean") return invalid(`${key} is true or false`);
      patch[key] = v;
    } else if (key === "siteName") {
      if (typeof v !== "string" || v.length > MAX_SITE_NAME_LENGTH) return invalid(`the site name is at most ${MAX_SITE_NAME_LENGTH} characters`);
      patch.siteName = v;
    } else if (key === "announcement") {
      if (typeof v !== "string" || v.length > MAX_ANNOUNCEMENT_LENGTH) return invalid(`the announcement is at most ${MAX_ANNOUNCEMENT_LENGTH} characters`);
      patch.announcement = v;
    } else if (key === "banner") {
      const b = (v ?? {}) as { text?: unknown; color?: unknown };
      if (typeof b.text !== "string" || b.text.length > MAX_ANNOUNCEMENT_LENGTH) return invalid(`the banner text is at most ${MAX_ANNOUNCEMENT_LENGTH} characters`);
      if (!(BANNER_COLORS as readonly unknown[]).includes(b.color)) return invalid(`a banner color is one of ${BANNER_COLORS.join(", ")}`);
      patch.banner = { text: b.text, color: b.color as BannerColor };
    } else if (key === "accentColor") {
      if (typeof v !== "string" || (v !== "" && !HEX.test(v))) return invalid('an accent color is a hex color such as "#3b82f6", or "" for the default');
      patch.accentColor = v;
    } else {
      return invalid(`${key} is not a workspace setting this page changes`);
    }
  }
  if (!Object.keys(patch).length) return invalid("name at least one setting to change");
  return { ok: true, patch };
}

/** Reads, or writes then reads back, as `by`'s agent session; the adapter's refusals keep their codes. */
export async function workspaceSettings(adapter: WorkspaceSettingsAdapter | null, as: ActingAs, input?: unknown): Promise<SettingsResult> {
  if (!adapter) return { ok: false, code: "WORKSPACE_UNAVAILABLE", reason: "this tenant has no workspace" };
  let r: Awaited<ReturnType<WorkspaceSettingsAdapter["readSettings"]>>;
  if (input === undefined) {
    r = await adapter.readSettings(as);
  } else {
    const checked = checkSettingsPatch(input);
    if (!checked.ok) return checked;
    r = await adapter.writeSettings(as, checked.patch);
  }
  return r.ok ? { ok: true, settings: r.value } : { ok: false, code: `WORKSPACE_${r.code}`, reason: r.reason };
}
