// The Settings dialog's panes as markup (M27.6; split from settings.ts for the 600-line cap, which keeps the
// frame, the rules and the script): General, Company and Background work, Devices, Security (F41), Messaging
// channels, Help & support and the Report an issue dialog, each the system's grouped cards. Settings' words live here too, so the
// markup and the script read one table.
import type { MemberSource } from "../../company/members.ts";
import { APPS_LINK } from "../../workspace/surfaces.ts";
import { type IconName, ic, type Tier } from "./icons.ts";

/** Settings' own words, one table, so a test walks them for a code shown as words. */
export const SETTINGS_TEXT = {
  title: "Settings",
  back: "Go back",
  close: "Close",
  thisMonth: "This month",
  monthNote: "Usage is shown, never hidden",
  dailyCap: "Daily cap",
  capNote: "Your agent stops and asks before going over",
  plan: "Caps and plan",
  connectors: "Connectors",
  permissions: "Permissions",
  devices: "Devices",
  messaging: "Messaging channels",
  mailOn: "Mail when nothing else reached you",
  mailOff: "Chat and notifications only",
  company: "Company · you are an admin",
  companyRow: "Company",
  members: "Members",
  memberHead: ["Email", "From", "Role", ""],
  source: { "tenant-file": "Company file", invite: "Invited" } satisfies Record<MemberSource, string> as Record<string, string>,
  invites: "Invites",
  invited: "invited",
  invite: "Invite",
  inviteEmail: "Email",
  inviteRole: "Role",
  admin: "Company admin",
  adminSub: "Tenants, loops and the ledger",
  home: "Add to home screen",
  homeHow: "Open your browser's menu and choose Add to Home Screen (on an iPhone: the share button, then Add to Home Screen).",
  report: "Report an issue",
  reportLine: "I'd like to report an issue: ",
  reportPlaceholder: "What happened?",
  reportGo: "Submit",
  help: "Help",
  helpHow: "Ask your agent in the chat. For anything it cannot sort out, tell an admin of your company.",
  delivery: "Delivery",
  deliveryIntro: "Where your agent reaches you outside the chat.",
  zone: "Time zone",
  zoneNote: "Quiet hours and digests follow it",
  mail: "Mail fallback",
  mailNote: "Mail me when nothing else reached me",
  save: "Save",
  stopped: "Stopped notifications",
  nothingStopped: "Nothing stopped.",
  allowAgain: "Allow again",
  loops: "Background work",
  loopsIntro: "What your agent does on its own, and how many tokens each may spend a day.",
  loopsOn: ["loop on", "loops on"],
  tokensADay: "tokens a day",
  account: "Your account",
  usage: "Usage",
  accountRow: "Account",
  signedIn: "{person} · {role} at {tenant}",
  logout: "Log out",
  logoutFailed: "Not logged out: that did not go through. Try again.",
  reading: "Reading…",
  appearance: "Appearance",
  mode: "Mode",
  modes: { light: "Light", dark: "Dark", system: "System" },
  thisDeviceGroup: "This device",
  thisDevice: "This device",
  pushSwitch: "Notifications on this device",
  pushOn: "Notifications are on",
  pushOff: "Notifications are off",
  testRow: "Test notification",
  testNote: "Sends one to each device that is on",
  test: "Test",
  othersGroup: "Other devices",
  workspace: "Your agent's workspace",
  workspaceSub: "Always on",
  since: "Notifications on since {date}",
  pushHosts: { "fcm.googleapis.com": "Chrome or Android device", "updates.push.services.mozilla.com": "Firefox device", "web.push.apple.com": "Apple device" } as Record<string, string>,
  otherDevice: "Another browser",
  noOthers: "No other devices",
  run: ["run", "runs"],
  token: ["token", "tokens"],
  free: "$0.00",
  cheap: "less than $0.01",
  // Security (F41, delta 4): the words of the specimen `ds/specimens/security.html`, over the host's passkey routes.
  security: "Security",
  securityIntro: "A passkey is how you sign in here. Keep at least two, on different devices.",
  passkeys: "Passkeys",
  passkey: "Passkey",
  added: "Added {date}",
  remove: "Remove",
  removeLabel: "Remove the passkey added {date}",
  addPasskey: "Add a passkey",
  lastPasskey: "The last passkey stays. Add another before removing this one.",
  recoverySignIn: "Add a passkey first. A recovery sign-in cannot manage passkeys.",
  ownerOnly: "Only the owner manages passkeys.",
  notRemoved: "Not removed: that did not go through. Try again.",
  sessions: "Sessions",
  sessionLine: "This browser is signed in for thirty days from the last sign-in.",
  sessionNote: "Log out ends it. No list of other sessions is kept here.",
  recovery: "Recovery code",
  recoveryLine: "Shown once, when the first passkey was added.",
  recoveryNote: "Replaced when a passkey is added after a recovery sign-in. It is not readable here.",
};

/** The Appearance modes, stored in this browser under MODE_KEY and applied to the body's data-theme. */
export const MODES = ["light", "dark", "system"] as const;
export const MODE_KEY = "qyvr-mode";

/** A Settings row (SettingsDialog `.qf-srow`): the 28 px glyph, the title with its optional line, the value and the chevron. */
const setRow = (o: { id: string; tag?: "button" | "a" | "div"; href?: string; glyph?: IconName; tier?: Tier; title: string; sub?: string; subId?: string; value?: string; chevron?: boolean }) => {
  const tag = o.tag ?? "button";
  const sub = o.sub !== undefined || o.subId ? `<span${o.subId ? ` id="${o.subId}"` : ""} class="sub">${o.sub ?? ""}</span>` : "";
  const value = o.value ? `<span id="${o.value}" class="val"></span>` : "";
  const chevron = o.chevron === false ? "" : ic(tag === "a" && o.href?.startsWith("http") ? "ext" : "chev", tag === "a" && o.href?.startsWith("http") ? "2xs" : "xs");
  const glyph = o.glyph ? `<span class="set-ico">${ic(o.glyph, o.tier ?? "sm")}</span>` : "";
  return `<${tag} id="${o.id}" class="qf-srow${tag === "div" ? " is-static" : ""}"${o.href ? ` href="${o.href}"` : ""}>${glyph}<span class="tx">${o.title}${sub}</span><span class="trail">${value}${chevron}</span></${tag}>`;
};
/** A progress row (the canvas's Usage rows): the title over its line and the bar, the value at the end. */
const usageRow = (id: string, title: string, sub: string, label: string) =>
  `<div class="qf-srow is-static set-usage"><span class="tx">${title}<span class="sub">${sub}</span><span id="${id}-meter" class="qf-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="${id}-fill" style="width:0%"></i></span></span><span class="trail"><span id="usage-${id === "cap" ? "day" : "month"}" class="val"></span></span></div>`;
const MODE_GLYPH: Record<(typeof MODES)[number], IconName> = { light: "sun", dark: "moon", system: "monitor" };

/** General, in the canvas's order: the account, Usage, the rows into the other panes, Appearance, the admin's Company. */
export const GENERAL_PANE = `<div id="settings">
  <div class="qf-grpcard">${setRow({ id: "set-account", tag: "div", glyph: "user", tier: "md", title: SETTINGS_TEXT.accountRow, subId: "me", chevron: false })}</div>
  <div class="qf-grp"><h3>${SETTINGS_TEXT.usage}</h3>
  <div id="usage" class="qf-grpcard">
    ${usageRow("month", SETTINGS_TEXT.thisMonth, SETTINGS_TEXT.monthNote, "This month's tokens against the daily cap so far")}
    ${usageRow("cap", SETTINGS_TEXT.dailyCap, SETTINGS_TEXT.capNote, "Daily cap used")}
    <a id="plan" class="qf-srow is-link" href="/app/dashboard">${SETTINGS_TEXT.plan}</a>
  </div></div>
  <div class="qf-grpcard">${setRow({ id: "set-connectors", glyph: "plug", title: SETTINGS_TEXT.connectors, value: "set-connectors-count" })}</div>
  <div class="qf-grpcard">${setRow({ id: "set-permissions", glyph: "shield", title: SETTINGS_TEXT.permissions })}</div>
  <div class="qf-grpcard">${setRow({ id: "set-security", glyph: "key", title: SETTINGS_TEXT.security })}</div>
  <div class="qf-grp"><h3>${SETTINGS_TEXT.appearance}</h3><div class="qf-grpcard">
    <div id="set-appearance" class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.mode}</span><span class="seg2 set-mode" role="radiogroup" aria-label="${SETTINGS_TEXT.mode}">${MODES.map((k) => `<button id="mode-${k}" class="tab" role="radio" aria-checked="false" aria-label="${SETTINGS_TEXT.modes[k]}">${ic(MODE_GLYPH[k], "xs")}</button>`).join("")}</span></div>
  </div></div>
  <div class="qf-grpcard">
    ${setRow({ id: "set-devices", glyph: "monitor", title: SETTINGS_TEXT.devices, value: "set-devices-count" })}
    ${setRow({ id: "set-messaging", glyph: "chat", title: SETTINGS_TEXT.messaging, subId: "set-messaging-state" })}
  </div>
  <div class="qf-grpcard">${setRow({ id: "set-loops", glyph: "clock", title: SETTINGS_TEXT.loops, value: "loops-count" })}</div>
  <div id="admin" class="qf-grp" hidden><h3>${SETTINGS_TEXT.company}</h3><div class="qf-grpcard">
    ${setRow({ id: "set-company", glyph: "user", title: SETTINGS_TEXT.companyRow, value: "members-count" })}
  </div></div>
</div>`;

/** Company, for an admin (BUILD-ONLY): the members as a FilesTable, the invite form, the invites and the links. */
export const COMPANY_PANE = `<div id="set-company-pane">
  <div class="qf-grp"><h3>${SETTINGS_TEXT.members}</h3>
    <div id="members-panel" class="qf-files"><div class="qf-files-h">${SETTINGS_TEXT.memberHead.map((h) => `<span>${h}</span>`).join("")}</div><div id="members"></div></div>
  </div>
  <div class="qf-grp"><h3>${SETTINGS_TEXT.invite}</h3>
    <form id="invite" class="qf-grpcard set-box">
      <input id="invite-email" class="qf-input" type="email" placeholder="${SETTINGS_TEXT.inviteEmail}" aria-label="${SETTINGS_TEXT.inviteEmail}" required>
      <select id="invite-role" class="qf-select" aria-label="${SETTINGS_TEXT.inviteRole}"><option value="member">member</option><option value="admin">admin</option></select>
      <div class="set-act"><button id="invite-go" class="qf-btn qf-btn--primary">${SETTINGS_TEXT.invite}</button></div>
    </form>
    <p id="invite-result" class="set-note"></p>
  </div>
  <div class="qf-grpcard">
    ${setRow({ id: "set-invites", tag: "div", glyph: "user", title: SETTINGS_TEXT.invites, subId: "invites-count", chevron: false })}
    ${setRow({ id: "company-admin", tag: "a", href: "/admin", glyph: "key", title: SETTINGS_TEXT.admin, sub: SETTINGS_TEXT.adminSub })}
    ${setRow({ id: "company-apps", tag: "a", href: APPS_LINK.href, glyph: "sparkle", title: APPS_LINK.label, sub: APPS_LINK.sub })}
  </div>
</div>`;

/** Background work (BUILD-ONLY): each loop's daily budget and its Switch. */
export const LOOPS_PANE = `<div id="loops">
  <p class="qf-set-intro">${SETTINGS_TEXT.loopsIntro}</p>
  <div id="loop-table" class="qf-grpcard"></div>
  <p id="loop-result" class="set-note"></p>
</div>`;

/** Devices: this device's push Switch and Test, then the other devices as two-line rows. */
export const DEVICES_PANE = `<div id="set-devices-pane">
  <div class="qf-grp"><h3>${SETTINGS_TEXT.thisDeviceGroup}</h3><div class="qf-grpcard">
    <div class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.thisDevice}<span id="device-state" class="sub"></span></span><input id="push-on" type="checkbox" role="switch" class="qf-switch" aria-label="${SETTINGS_TEXT.pushSwitch}"></div>
    <div class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.testRow}<span class="sub">${SETTINGS_TEXT.testNote}</span></span><button id="push-test" class="qf-tlink">${SETTINGS_TEXT.test}</button></div>
  </div></div>
  <p id="push-result" class="set-note" role="status"></p>
  <div class="qf-grp"><h3>${SETTINGS_TEXT.othersGroup}</h3><div id="device-others" class="qf-grpcard"></div></div>
</div>`;

/**
 * Security (F41, delta 4; the specimen `ds/specimens/security.html`): the passkeys `GET /login/passkeys` lists, by the
 * date each was added and never a key, each with Remove (`DELETE /login/passkeys/:id`), then Add a passkey to the
 * sign-in page; what a session is, with Log out; what the recovery code is. The rows, the count and a refusal in words
 * are the script's, from the routes' answer; nothing here is stored.
 */
export const SECURITY_PANE = `<div id="set-security-pane">
  <p id="security-intro" class="qf-set-intro">${SETTINGS_TEXT.securityIntro}</p>
  <div class="qf-grp"><h3>${SETTINGS_TEXT.passkeys}<span id="passkey-count" class="qf-chip qf-chip--count" hidden></span></h3><div id="passkey-card" class="qf-grpcard">
    <a id="passkey-add" class="qf-srow is-link" href="/login" style="text-decoration:none">${SETTINGS_TEXT.addPasskey}</a>
  </div></div>
  <div id="security-sessions" class="qf-grp"><h3>${SETTINGS_TEXT.sessions}</h3><div class="qf-grpcard">
    <div class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.sessionLine}<span class="sub">${SETTINGS_TEXT.sessionNote}</span></span><span class="trail"><button id="security-logout" class="qf-btn qf-btn--secondary" type="button">${SETTINGS_TEXT.logout}</button></span></div>
  </div></div>
  <p id="security-logout-result" class="set-note" role="status"></p>
  <div id="security-recovery" class="qf-grp"><h3>${SETTINGS_TEXT.recovery}</h3><div class="qf-grpcard">
    <div class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.recoveryLine}<span class="sub">${SETTINGS_TEXT.recoveryNote}</span></span></div>
  </div></div>
</div>`;

/** Messaging channels: the delivery rows (time zone, mail fallback) and what was stopped. */
export const MESSAGING_PANE = `<div id="set-messaging-pane">
  <p id="delivery-now" class="qf-set-intro">${SETTINGS_TEXT.deliveryIntro}</p>
  <form id="delivery-form" class="qf-grp"><h3>${SETTINGS_TEXT.delivery}</h3><div class="qf-grpcard">
    <label class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.zone}<span class="sub">${SETTINGS_TEXT.zoneNote}</span></span><input id="delivery-zone" name="zone" class="qf-select set-field" placeholder="Europe/London" aria-label="${SETTINGS_TEXT.zone}"></label>
    <label class="qf-srow is-static"><span class="tx">${SETTINGS_TEXT.mail}<span class="sub">${SETTINGS_TEXT.mailNote}</span></span><input id="delivery-mail" name="mail" type="checkbox" role="switch" class="qf-switch" aria-label="${SETTINGS_TEXT.mailNote}"></label>
    <div class="qf-srow is-static"><span class="tx"></span><button id="delivery-save" class="qf-tlink">${SETTINGS_TEXT.save}</button></div>
  </div></form>
  <p id="delivery-result" class="set-note" role="status"></p>
  <div class="qf-grp"><h3>${SETTINGS_TEXT.stopped}</h3><p id="stopped-note" class="set-note"></p><div id="stopped-table" class="qf-grpcard"></div></div>
</div>`;

/** Help & support: Help, Report an issue, Add to home screen, and the line they answer on. */
export const HELP_PANE = `<div id="set-help-pane">
  <div class="qf-grpcard">
    ${setRow({ id: "set-help", title: SETTINGS_TEXT.help })}
    ${setRow({ id: "set-report", title: SETTINGS_TEXT.report })}
    ${setRow({ id: "set-home", title: SETTINGS_TEXT.home })}
  </div>
  <p id="set-note" class="set-note" role="status"></p>
</div>`;

/** Report an issue (Dialog 512, over Settings): what happened, and Submit, which opens the chat with it. */
export const REPORT_DIALOG = `<div id="report" class="qf-dlg qf-dlg--512" role="dialog" aria-labelledby="report-title" hidden>
  <div class="qf-dlg-head"><h2 id="report-title">${SETTINGS_TEXT.report}</h2><button id="report-close" class="qf-ibtn qf-ibtn--glass qf-ibtn--28" aria-label="${SETTINGS_TEXT.close}">${ic("x", "xs")}</button></div>
  <form id="report-form" class="qf-dlg-body"><textarea id="report-text" class="qf-ta" placeholder="${SETTINGS_TEXT.reportPlaceholder}" aria-label="${SETTINGS_TEXT.reportPlaceholder}"></textarea><button id="report-go" class="qf-btn qf-btn--primary">${SETTINGS_TEXT.reportGo}</button></form>
</div>`;
