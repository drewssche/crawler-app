export type DiffLine = {
  kind: "same" | "added" | "removed";
  left: string;
  right: string;
};

export function buildLineDiff(leftText: string, rightText: string, maxLines = 400): DiffLine[] {
  const left = leftText ? leftText.split(/\r?\n/).slice(0, maxLines) : [];
  const right = rightText ? rightText.split(/\r?\n/).slice(0, maxLines) : [];
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "same", left: left[i], right: right[j] });
      i += 1;
      j += 1;
    } else if (j < right.length && (i >= left.length || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ kind: "added", left: "", right: right[j] });
      j += 1;
    } else {
      result.push({ kind: "removed", left: left[i], right: "" });
      i += 1;
    }
  }
  return result;
}
