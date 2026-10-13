import { z } from "zod";

import type { AuthErrorCode } from "@/lib/backend/port";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Enter a valid email address.").max(254, "Email address is too long."),
);
export const emailSchema = email;

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

export const profileNameSchema = z.object({
  fullName: personName,
});

const optionalText = (max: number, message: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? "" : v),
    z.string().trim().max(max, message),
  );

export const companyProfileSchema = z.object({
  name: personName,
  contactEmail: z.preprocess((v) => (v === null || v === undefined ? "" : v), z.union([email, z.literal("")])),
  phone: optionalText(40, "Use at most 40 characters."),
  address: optionalText(500, "Use at most 500 characters."),
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

export const resetPasswordSchema = z
  .object({
    newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
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

// Map normalized AuthErrorCodes to messages that reveal nothing about other
// accounts or internals. Unknown/unavailable become a generic message.
export function friendlyAuthError(code: AuthErrorCode | null | undefined): string {
  switch (code) {
    case "email_not_confirmed":
      return "Confirm your email address first. Check your inbox for the confirmation link.";
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "weak_password":
      return "That password is too weak. Use a longer, less common password.";
    case "same_password":
      return "Choose a password different from the current one.";
    case "invalid_credentials":
      return "Invalid email or password.";
    case "session_required":
      return "Your session has expired. Sign in again.";
    case "unavailable":
      return "The service is temporarily unavailable. Please try again shortly.";
    default:
      return "Something went wrong. Please try again.";
  }
}
