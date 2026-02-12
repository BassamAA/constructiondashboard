const LEBANON_TIMEZONE = "Asia/Beirut";

const DEFAULT_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: LEBANON_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const DATE_ONLY_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: LEBANON_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

export function formatLebanonDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("en-GB", DEFAULT_FORMAT_OPTIONS);
}

export function formatLebanonDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("en-GB", DATE_ONLY_OPTIONS);
}
