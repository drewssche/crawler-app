export function safeSnapshotDocument(html: string, options?: { elementPicker?: boolean }): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(html || "<html><body></body></html>", "text/html");
  for (const node of document.querySelectorAll("script, iframe, object, embed, form, base, meta[http-equiv]")) {
    node.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
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
  csp.setAttribute("content", options?.elementPicker
    ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
  document.head.prepend(csp);
  if (options?.elementPicker) {
    const style = document.createElement("style");
    style.textContent = `
      [data-crawler-picker-hover] { outline: 2px solid rgba(120, 166, 255, 0.88) !important; outline-offset: 2px !important; cursor: crosshair !important; }
      [data-crawler-picker-selected] { outline: 3px solid rgba(231, 161, 90, 0.95) !important; outline-offset: 3px !important; }
    `;
    document.head.append(style);
    const script = document.createElement("script");
    script.textContent = `
      (() => {
        function selectorFor(element) {
          const parts = [];
          let node = element;
          while (node && node.nodeType === 1 && parts.length < 8) {
            let part = node.tagName.toLowerCase();
            if (node.id) {
              part += "#" + node.id.replace(/[^a-zA-Z0-9_-]/g, "");
              parts.unshift(part);
              break;
            }
            const className = String(node.className || "").trim().split(/\\s+/).filter(Boolean).slice(0, 3).join(".");
            if (className) part += "." + className;
            const parent = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter((item) => item.tagName === node.tagName);
              if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
            }
            parts.unshift(part);
            node = parent;
          }
          return parts.join(" > ");
        }
        function clear(name) {
          document.querySelectorAll("[" + name + "]").forEach((node) => node.removeAttribute(name));
        }
        document.addEventListener("mouseover", (event) => {
          const target = event.target;
          if (!(target instanceof Element) || target === document.documentElement || target === document.body) return;
          clear("data-crawler-picker-hover");
          target.setAttribute("data-crawler-picker-hover", "true");
        }, true);
        document.addEventListener("mouseout", () => clear("data-crawler-picker-hover"), true);
        document.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element) || target === document.documentElement) return;
          event.preventDefault();
          event.stopPropagation();
          clear("data-crawler-picker-selected");
          target.setAttribute("data-crawler-picker-selected", "true");
          const rect = target.getBoundingClientRect();
          window.parent.postMessage({
            type: "crawler:element-selected",
            payload: {
              tag: target.tagName.toLowerCase(),
              id: target.id || "",
              className: String(target.className || ""),
              selector: selectorFor(target),
              text: (target.innerText || target.textContent || "").trim().slice(0, 500),
              outerHTML: target.outerHTML.slice(0, 20000),
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            }
          }, "*");
        }, true);
      })();
    `;
    document.body.append(script);
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
