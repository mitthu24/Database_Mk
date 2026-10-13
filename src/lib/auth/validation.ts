import { z } from "zod";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Enter a valid email address.").max(254, "Email address is too long."),
);

// 72 is the bcrypt input limit Supabase enforces.
const newPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use at most 72 characters.");

const personName = z
  .string()
  .trim()
  .min(2, "Enter at least 2 characters.")
  .max(120, "Use at most 120 characters.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(72, "Password is too long."),
});

export const registerSchema = z.object({
  fullName: personName,
  companyName: personName,
  email,
  password: newPassword,
});

export const companySchema = z.object({
  companyName: personName,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(72),
    newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from the current one.",
  });

export const employeeSchema = z.object({
  email,
  fullName: personName,
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,32}$/, "Use 1-32 letters, digits, dot, underscore or dash.")
    .optional(),
});

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export function fieldErrorsFrom(error: z.ZodError): Record<string, string[] | undefined> {
  return z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
}

// Only same-origin relative paths are allowed as post-login destinations.
export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const parsed = new URL(raw, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") return fallback;
  } catch {
    return fallback;
  }
  if (raw.startsWith("/auth/") || raw === "/login" || raw === "/register") return fallback;
  return raw;
}

// Map Supabase Auth errors to messages that reveal nothing about other accounts
// or internals. Unknown errors become a generic message.
export function friendlyAuthError(error: { code?: string; status?: number } | null | undefined): string {
  switch (error?.code) {
    case "email_not_confirmed":
      return "Confirm your email address first. Check your inbox for the confirmation link.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "weak_password":
      return "That password is too weak. Use a longer, less common password.";
    case "same_password":
      return "Choose a password different from the current one.";
    case "invalid_credentials":
      return "Invalid email or password.";
    default:
      return error?.status === 429
        ? "Too many attempts. Please wait a few minutes and try again."
        : "Something went wrong. Please try again.";
  }
}
