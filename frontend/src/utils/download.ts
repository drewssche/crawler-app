import { apiDownload } from "../api/client";

export async function downloadBlobFile(path: string, filename: string): Promise<void> {
  const blob = await apiDownload(path);
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.setAttribute("download", filename);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

