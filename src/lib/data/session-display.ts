export function formatSessionDateLabel(sessionDate: string): string {
  return new Date(`${sessionDate}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

export function formatSessionTimeLabel(value: string | null): string | null {
  if (!value || value.length < 16) {
    return null;
  }

  const hour = Number.parseInt(value.slice(11, 13), 10);
  const minute = value.slice(14, 16);

  if (!Number.isFinite(hour) || Number.isNaN(hour)) {
    return null;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minute} ${period}`;
}
