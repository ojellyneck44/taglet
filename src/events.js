// Anonymous usage counts for Workers Analytics Engine (binding EVENTS, dataset taglet_events). Never pass emails, file names,
// titles or anything personal. blob1 = event name, blob2/blob3 = short details. Without the binding this does nothing.
// Our own traffic isn't counted: browsers that opened /api/team once (?off=1 undoes it), and anything that isn't a real
// browser (curl, scripts, headless Chrome). Pass request = null for server-only events.
export const TEAM_COOKIE = "taglet_team";
export const isTeam = (request) => {
  if (!request) return false;
  const ua = request.headers.get("user-agent") || "";
  return !ua.startsWith("Mozilla/") || /Headless/i.test(ua) || new RegExp(`(?:^|;\s*)${TEAM_COOKIE}=1`).test(request.headers.get("cookie") || "");
};
export function logEvent(env, request, name, ...details) {
  if (isTeam(request)) return;
  try { env.EVENTS?.writeDataPoint({ indexes: [name], blobs: [name, ...details.map((d) => String(d ?? "").slice(0, 32))], doubles: [1] }); } catch {}
}
