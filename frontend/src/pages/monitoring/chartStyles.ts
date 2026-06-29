export function highlightStyle(active: boolean) {
  return active
    ? { borderColor: "rgba(106,160,255,0.72)", boxShadow: "0 0 0 2px rgba(106,160,255,0.2)" }
    : {};
}
