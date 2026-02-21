export function parseUserAgentParts(ua: string | null | undefined): { browser: string; os: string } {
  if (!ua) return { browser: "-", os: "-" };
  const lower = ua.toLowerCase();
  const browser =
    lower.includes("yabrowser") ? "Yandex Browser" :
    lower.includes("edg/") ? "Edge" :
    lower.includes("chrome/") ? "Chrome" :
    lower.includes("firefox/") ? "Firefox" :
    lower.includes("safari/") ? "Safari" : "Browser";
  const os =
    lower.includes("windows") ? "Windows" :
    lower.includes("android") ? "Android" :
    lower.includes("iphone") || lower.includes("ios") ? "iOS" :
    lower.includes("mac os") || lower.includes("macintosh") ? "macOS" :
    lower.includes("linux") ? "Linux" : "OS";
  return { browser, os };
}

export function shortUserAgent(ua: string | null | undefined): string {
  const parts = parseUserAgentParts(ua);
  if (parts.browser === "-" && parts.os === "-") return "-";
  return `${parts.browser} • ${parts.os}`;
}
