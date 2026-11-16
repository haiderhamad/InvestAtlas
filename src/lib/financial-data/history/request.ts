export interface PersonalHistoryRange { from: string; to: string }
const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : null;
}

function yearsBefore(day: number, count: number): string {
  const value = new Date(day);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() - count);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0,10);
}

/** Five calendar years maximum, always ending before today's unfinished UTC day. */
export function normalizePersonalHistoryRange(
  input: {range?: unknown; from?: unknown; to?: unknown}, now = Date.now(),
): PersonalHistoryRange | null {
  const today = Math.floor(now / DAY) * DAY;
  const end = today - DAY;
  if (input.from !== undefined || input.to !== undefined) {
    const from = timestamp(input.from), to = timestamp(input.to);
    if (from === null || to === null || from > to || to >= today
      || from < Date.parse(yearsBefore(end, 5))) return null;
    return { from: input.from as string, to: input.to as string };
  }
  const range = typeof input.range === 'string' ? input.range.toLowerCase() : input.range === undefined ? '1y' : '';
  const years = range === '1y' ? 1 : range === '3y' ? 3 : range === '5y' || range === 'all' ? 5 : 0;
  return years ? {from: yearsBefore(end, years), to:new Date(end).toISOString().slice(0,10)} : null;
}

export function splitHistoryRange(range: PersonalHistoryRange, maximumDays = 400): PersonalHistoryRange[] {
  const from = timestamp(range.from), to = timestamp(range.to);
  if (from === null || to === null || from > to || !Number.isSafeInteger(maximumDays) || maximumDays < 1 || maximumDays > 400) {
    throw new Error('Invalid bounded history interval');
  }
  const chunks: PersonalHistoryRange[] = [];
  for (let start = from; start <= to; start += maximumDays * DAY) {
    chunks.push({ from:new Date(start).toISOString().slice(0,10), to:new Date(Math.min(to,start+(maximumDays-1)*DAY)).toISOString().slice(0,10) });
    if (chunks.length > 10) throw new Error('History interval exceeds allowed coverage');
  }
  return chunks;
}
