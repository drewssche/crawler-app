import { apiDownloadWithProgress } from "../api/client";

type DownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

export async function downloadBlobFile(
  path: string,
  filename: string,
  options?: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void },
): Promise<void> {
  const blob = await apiDownloadWithProgress(path, {
    signal: options?.signal,
    onProgress: (receivedBytes, totalBytes) => {
      const percent = totalBytes && totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null;
      options?.onProgress?.({ receivedBytes, totalBytes, percent });
    },
  });
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
