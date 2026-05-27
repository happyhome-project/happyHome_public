const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(value, label) {
  if (!DATE_RE.test(value || "")) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }

  return value;
}

export function assertDateRange(beginDate, endDate) {
  const begin = assertDate(beginDate, "begin_date");
  const end = assertDate(endDate, "end_date");

  if (begin > end) {
    throw new Error("begin_date must be earlier than or equal to end_date");
  }

  return { begin_date: begin, end_date: end };
}

export function compactDate(value) {
  return assertDate(value, "date").replaceAll("-", "");
}
