import holidayData from '../data/japanHolidays.json' with { type: 'json' };

const YEAR_END_DATES = new Set(['12-31', '01-02', '01-03']);

function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00+09:00`);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatYmd(value) {
  const date = toDate(value);
  if (!date) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(value, days) {
  const date = toDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function yearRecord(value) {
  const ymd = formatYmd(value);
  const year = ymd.slice(0, 4);
  return holidayData[year] || null;
}

export function isWeekend(value) {
  const date = toDate(value);
  if (!date) return false;
  const tokyoDate = new Date(`${formatYmd(date)}T00:00:00+09:00`);
  const day = tokyoDate.getDay();
  return day === 0 || day === 6;
}

export function isJapaneseHoliday(value) {
  const ymd = formatYmd(value);
  const record = yearRecord(value);
  return Boolean(record?.holidays?.[ymd]);
}

export function getJapaneseHolidayName(value) {
  const ymd = formatYmd(value);
  const record = yearRecord(value);
  return record?.holidays?.[ymd] || '';
}

export function getHolidayDataStatus(value) {
  const record = yearRecord(value);
  if (!record) {
    return {
      configured: false,
      complete: false,
      label: '祝日データ未設定',
      detail: '対象年の祝日データがないため、土日と年末年始だけで簡易判定しています。',
    };
  }
  return {
    configured: true,
    complete: Boolean(record.complete),
    label: record.complete ? '祝日データ設定済み' : '祝日データ未完全',
    detail: record.complete
      ? '手動管理の日本祝日データを使って営業日を判定しています。'
      : '祝日データが未完全のため、一次情報の確認を優先してください。',
  };
}

export function buildBusinessDayStatus(value) {
  const ymd = formatYmd(value);
  if (!ymd) {
    return {
      date: '',
      isBusinessDay: false,
      reason: 'データ未取得',
      label: '営業日判定不可',
      holidayDataStatus: getHolidayDataStatus(new Date()),
    };
  }
  const holidayStatus = getHolidayDataStatus(value);
  const monthDay = ymd.slice(5);
  if (isWeekend(value)) {
    return { date: ymd, isBusinessDay: false, reason: '土日', label: '本日は休場日です', holidayDataStatus: holidayStatus };
  }
  if (YEAR_END_DATES.has(monthDay)) {
    return { date: ymd, isBusinessDay: false, reason: '年末年始', label: '本日は休場日です', holidayDataStatus: holidayStatus };
  }
  const holidayName = getJapaneseHolidayName(value);
  if (holidayName) {
    return { date: ymd, isBusinessDay: false, reason: holidayName === '振替休日' ? '振替休日' : '祝日', label: '本日は祝日または休場日です', holidayName, holidayDataStatus: holidayStatus };
  }
  if (!holidayStatus.configured) {
    return { date: ymd, isBusinessDay: true, reason: '祝日データ未設定', label: '簡易営業日判定です', holidayDataStatus: holidayStatus };
  }
  if (!holidayStatus.complete) {
    return { date: ymd, isBusinessDay: true, reason: '祝日データ未完全', label: '簡易営業日判定です', holidayDataStatus: holidayStatus };
  }
  return { date: ymd, isBusinessDay: true, reason: '平日', label: '本日は営業日です', holidayDataStatus: holidayStatus };
}

export function isBusinessDay(value) {
  return buildBusinessDayStatus(value).isBusinessDay;
}

export function getPreviousBusinessDay(value) {
  let cursor = addDays(value, -1);
  for (let count = 0; count < 14; count += 1) {
    if (cursor && isBusinessDay(cursor)) return formatYmd(cursor);
    cursor = addDays(cursor, -1);
  }
  return '';
}

export function getNextBusinessDay(value) {
  let cursor = addDays(value, 1);
  for (let count = 0; count < 14; count += 1) {
    if (cursor && isBusinessDay(cursor)) return formatYmd(cursor);
    cursor = addDays(cursor, 1);
  }
  return '';
}

export function buildMorningCheckWindow(now = new Date()) {
  const targetDate = formatYmd(now);
  const businessDay = buildBusinessDayStatus(now);
  const previousBusinessDay = getPreviousBusinessDay(now);
  const nextBusinessDay = getNextBusinessDay(now);
  const startDateTime = previousBusinessDay ? `${previousBusinessDay}T15:00:00+09:00` : '';
  const endDateTime = targetDate ? `${targetDate}T09:00:00+09:00` : '';
  return {
    targetDate,
    isBusinessDay: businessDay.isBusinessDay,
    businessDay,
    previousBusinessDay,
    nextBusinessDay,
    startDate: previousBusinessDay,
    endDate: targetDate,
    startDateTime,
    endDateTime,
    periodLabel: previousBusinessDay && targetDate ? `${previousBusinessDay} 15:00〜${targetDate} 09:00` : '対象期間未設定',
    note: businessDay.holidayDataStatus.detail,
  };
}
