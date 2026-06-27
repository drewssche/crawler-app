export function safeSnapshotDocument(html: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(html || "<html><body></body></html>", "text/html");
  for (const node of document.querySelectorAll("script, iframe, object, embed, form, base, meta[http-equiv]")) {
    node.remove();
  }
  for (const link of document.querySelectorAll("link[rel='stylesheet']")) link.remove();
  for (const image of document.querySelectorAll("img")) {
    const alt = image.getAttribute("alt") || "Изображение snapshot";
    image.removeAttribute("src");
    image.setAttribute("alt", alt);
    image.style.minHeight = "40px";
    image.style.background = "#ececec";
  }
  for (const anchor of document.querySelectorAll("a")) anchor.removeAttribute("href");
  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
  document.head.prepend(csp);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
