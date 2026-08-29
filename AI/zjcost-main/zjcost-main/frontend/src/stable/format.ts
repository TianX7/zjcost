export function money(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function num(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
  });
}

export function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value) * 100)}%`;
}

export function text(value: unknown, fallback = "--") {
  if (value == null || value === "") return fallback;
  return String(value);
}
