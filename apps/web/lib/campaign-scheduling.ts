const ISO_OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function localParts(value: string): LocalParts {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) throw new Error("Schedule time must use YYYY-MM-DDTHH:mm");
  const [, year, month, day, hour, minute] = match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  if (
    probe.getUTCFullYear() !== parts.year ||
    probe.getUTCMonth() + 1 !== parts.month ||
    probe.getUTCDate() !== parts.day ||
    probe.getUTCHours() !== parts.hour ||
    probe.getUTCMinutes() !== parts.minute
  ) {
    throw new Error("Schedule time is not a valid calendar time");
  }
  return parts;
}

function partsInTimeZone(date: Date, timeZone: string): LocalParts {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
  };
}

function partsEqual(left: LocalParts, right: LocalParts) {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute;
}

/**
 * Convert a wall-clock value entered for an IANA workspace timezone into an
 * absolute instant. We search around the UTC-shaped wall clock so DST gaps are
 * rejected and DST overlaps resolve deterministically to the earliest instant.
 */
export function zonedLocalDateTimeToInstant(value: string, timeZone: string): Date {
  const expected = localParts(value);
  const utcShape = Date.UTC(expected.year, expected.month - 1, expected.day, expected.hour, expected.minute);
  const matches: Date[] = [];

  // Every current IANA offset is within this window. Minute steps also support
  // zones with half-hour and quarter-hour offsets without depending on a date lib.
  for (let deltaMinutes = -14 * 60; deltaMinutes <= 14 * 60; deltaMinutes += 15) {
    const candidate = new Date(utcShape + deltaMinutes * 60_000);
    if (partsEqual(partsInTimeZone(candidate, timeZone), expected)) matches.push(candidate);
  }

  if (!matches.length) throw new Error(`Schedule time does not exist in ${timeZone}`);
  return matches[0]!;
}

export function formatDateTimeLocalInZone(date: Date, timeZone: string): string {
  const parts = partsInTimeZone(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Require an unambiguous ISO-8601 instant and ensure it is still in the future. */
export function parseCampaignScheduledAt(value: string | undefined, now = new Date()): Date | null {
  const input = value?.trim();
  if (!input) return null;
  if (!ISO_OFFSET_SUFFIX.test(input)) throw new Error("scheduledAt must include Z or a numeric timezone offset");
  const scheduledAt = new Date(input);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error("scheduledAt must be a valid ISO-8601 timestamp");
  if (scheduledAt.getTime() <= now.getTime()) throw new Error("scheduledAt must be in the future");
  return scheduledAt;
}
