import { BackendError, type AuthErrorCode } from "@/lib/backend/port";

// Postgres / PostgREST errors -> safe, user-presentable BackendErrors.
// The SQL functions raise deliberate, user-safe messages (validation, limits).
// Raw constraint violations are translated here; anything unrecognised becomes a
// generic message so internal details never reach the browser.

interface ErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  status?: number;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  table_metadata_company_name_key: "A table with that name already exists.",
  manual_payments_company_reference_key: "That payment reference was already submitted.",
  company_members_company_code_key: "That employee code is already used in your company.",
  manual_payments_amount_range: "Enter an amount greater than zero.",
  manual_payments_currency_fmt: "Use a 3-letter currency code, for example USD.",
  manual_payments_months_range: "Choose between 1 and 36 months.",
  manual_payments_reference_len: "Enter the payment reference (3-200 characters).",
  manual_payments_method_len: "Enter how the payment was made.",
  manual_payments_note_len: "The note is too long (1000 characters maximum).",
  platform_settings_value_len: "That value is too long.",
  companies_contact_email_len: "The contact email is too long.",
  companies_phone_len: "The phone number is too long.",
  companies_address_len: "The address is too long.",
  data_permissions_view_required: "Any operation also requires permission to view.",
};

function constraintOf(message: string): string | null {
  const m = /constraint "([^"]+)"/.exec(message) ?? /unique constraint "([^"]+)"/.exec(message);
  return m ? m[1] : null;
}

export function mapDatabaseError(error: ErrorLike): BackendError {
  const code = error.code ?? "";
  const message = (error.message ?? "").trim();

  if (code === "42501") return new BackendError("forbidden", "You do not have permission to do that.", code);
  if (code === "P0002") return new BackendError("not_found", "That item no longer exists.", code);
  if (code === "53400") return new BackendError("limit", message || "A limit was reached.", code);

  if (code === "23505") {
    const c = constraintOf(message);
    return new BackendError("conflict", (c && CONSTRAINT_MESSAGES[c]) || (message && !/violates|duplicate key/.test(message) ? message : "That already exists."), code);
  }
  if (code === "23503") return new BackendError("invalid", "That refers to something that does not exist.", code);

  if (code === "23514" || code === "22023" || code === "22P02" || code === "22003") {
    const c = constraintOf(message);
    if (c && CONSTRAINT_MESSAGES[c]) return new BackendError("invalid", CONSTRAINT_MESSAGES[c], code);
    if (message && !/violates|invalid input syntax|out of range/.test(message)) {
      return new BackendError("invalid", message.replace(/^row validation failed: /, "").replace(/^invalid columns: /, ""), code);
    }
    return new BackendError("invalid", "That value is not allowed.", code);
  }

  if (code === "PGRST301" || /jwt expired|JWT/i.test(message) || error.status === 401) {
    return new BackendError("forbidden", "Your session has expired. Sign in again.", "session");
  }

  const networkish = !code && /fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|timed? ?out|socket|aborted/i.test(message);
  if (networkish || (error.status !== undefined && error.status >= 500)) {
    return new BackendError("unavailable", "The service is temporarily unavailable. Please try again shortly.", code || "network");
  }
  return new BackendError("unknown", "Something went wrong. Please try again.", code || undefined);
}

export function toAuthErrorCode(error: { code?: string; status?: number; message?: string } | null | undefined): AuthErrorCode {
  switch (error?.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "rate_limited";
    case "weak_password":
      return "weak_password";
    case "same_password":
      return "same_password";
    case "session_not_found":
    case "refresh_token_not_found":
    case "no_authorization":
      return "session_required";
  }
  if (error?.status === 429) return "rate_limited";
  if (!error?.code && /fetch failed|network|ECONN|ENOTFOUND|timed? ?out/i.test(error?.message ?? "")) return "unavailable";
  return "unknown";
}
