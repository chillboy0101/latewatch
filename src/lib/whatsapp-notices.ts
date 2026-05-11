export type WhatsAppNoticeType = 'daily' | 'weekly';

type NoticeInputRow = {
  computedAmount: number | string | null;
  staffId: string;
  staffName: string | null;
  whatsappNotificationsEnabled?: boolean | null;
  whatsappPhone?: string | null;
};

export type WhatsAppNotice = {
  amount: string;
  href: string;
  message: string;
  phone: string;
  staffId: string;
  staffName: string;
  type: WhatsAppNoticeType;
};

const GHANA_LOCAL_PHONE_PATTERN = /^0\d{9}$/;
const GHANA_INTERNATIONAL_PHONE_PATTERN = /^233\d{9}$/;
const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function amountNumber(value: number | string | null | undefined) {
  const amount = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(amount) ? amount : 0;
}

function amountText(value: number) {
  return value.toFixed(2);
}

function staffName(value: string | null | undefined) {
  return value?.trim() || 'Staff member';
}

export function normalizeWhatsAppPhone(value: string | null | undefined) {
  if (!value) return null;

  const cleaned = value.trim().replace(/[\s().-]/g, '');

  if (GHANA_LOCAL_PHONE_PATTERN.test(cleaned)) {
    return `+233${cleaned.slice(1)}`;
  }

  if (GHANA_INTERNATIONAL_PHONE_PATTERN.test(cleaned)) {
    return `+${cleaned}`;
  }

  return E164_PHONE_PATTERN.test(cleaned) ? cleaned : null;
}

export function buildWhatsAppHref(phone: string, message: string) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return '';

  return `https://wa.me/${normalizedPhone.slice(1)}?text=${encodeURIComponent(message)}`;
}

export function createDailyWhatsAppMessage(input: { amount: string; date: string; staffName: string }) {
  return `Hello ${input.staffName}, LateWatch notice: your lateness penalty for ${input.date} is GHC ${input.amount}. Please contact Admin if this is incorrect.`;
}

export function createWeeklyWhatsAppMessage(input: { amount: string; staffName: string; weekEnd: string; weekStart: string }) {
  return `Hello ${input.staffName}, LateWatch weekly notice: your total lateness penalty for ${input.weekStart} to ${input.weekEnd} is GHC ${input.amount}. Please contact Admin if this is incorrect.`;
}

function createNotice(input: {
  amount: number;
  message: string;
  row: NoticeInputRow;
  type: WhatsAppNoticeType;
}): WhatsAppNotice | null {
  if (input.amount <= 0 || input.row.whatsappNotificationsEnabled !== true) return null;

  const phone = normalizeWhatsAppPhone(input.row.whatsappPhone);
  if (!phone) return null;

  return {
    amount: amountText(input.amount),
    href: buildWhatsAppHref(phone, input.message),
    message: input.message,
    phone,
    staffId: input.row.staffId,
    staffName: staffName(input.row.staffName),
    type: input.type,
  };
}

export function createDailyWhatsAppQueue(input: { date: string; rows: NoticeInputRow[] }) {
  return input.rows
    .map((row) => {
      const amount = amountNumber(row.computedAmount);
      const formattedAmount = amountText(amount);
      const name = staffName(row.staffName);

      return createNotice({
        amount,
        message: createDailyWhatsAppMessage({
          amount: formattedAmount,
          date: input.date,
          staffName: name,
        }),
        row: { ...row, staffName: name },
        type: 'daily',
      });
    })
    .filter((notice): notice is WhatsAppNotice => notice !== null)
    .sort((a, b) => a.staffName.localeCompare(b.staffName));
}

export function createWeeklyWhatsAppQueue(input: { rows: NoticeInputRow[]; weekEnd: string; weekStart: string }) {
  const totals = new Map<string, NoticeInputRow & { totalAmount: number }>();

  for (const row of input.rows) {
    const existing = totals.get(row.staffId);
    const amount = amountNumber(row.computedAmount);

    totals.set(row.staffId, {
      ...row,
      computedAmount: amount,
      totalAmount: (existing?.totalAmount || 0) + amount,
    });
  }

  return [...totals.values()]
    .map((row) => {
      const amount = row.totalAmount;
      const formattedAmount = amountText(amount);
      const name = staffName(row.staffName);

      return createNotice({
        amount,
        message: createWeeklyWhatsAppMessage({
          amount: formattedAmount,
          staffName: name,
          weekEnd: input.weekEnd,
          weekStart: input.weekStart,
        }),
        row: { ...row, staffName: name },
        type: 'weekly',
      });
    })
    .filter((notice): notice is WhatsAppNotice => notice !== null)
    .sort((a, b) => a.staffName.localeCompare(b.staffName));
}
