export function normalizeBangladeshPhone(input: string): string {
  const digits = input.replace(/\D+/g, "");

  if (!digits) return "";

  if (digits.startsWith("880") && digits.length >= 13) {
    return `+${digits.slice(0, 13)}`;
  }

  if (digits.startsWith("0") && digits.length >= 11) {
    return `+88${digits.slice(0, 11)}`;
  }

  if (digits.startsWith("1") && digits.length === 10) {
    return `+880${digits}`;
  }

  return `+${digits}`;
}

export function whatsappRecipientFromE164(e164: string): string {
  return e164.replace(/^\+/, "");
}
