import { z } from "zod";

// Client-visible bounds mirror the backend's own validation (manual_payments
// check constraints / the mock's equivalent checks); the backend remains the
// authority — this only gives fast, specific field errors.
export const paymentSchema = z.object({
  amount: z.coerce.number().gt(0, "Enter an amount greater than zero.").lt(100_000_000, "That amount is too large."),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, for example USD."),
  months: z.coerce.number().int().min(1, "Choose between 1 and 36 months.").max(36, "Choose between 1 and 36 months."),
  method: z.string().trim().min(1, "Enter how the payment was made.").max(60, "Use at most 60 characters."),
  reference: z.string().trim().min(3, "Enter the payment reference (3-200 characters).").max(200, "Use at most 200 characters."),
  note: z.preprocess((v) => (v === null || v === undefined ? "" : v), z.string().trim().max(1000, "Use at most 1000 characters.")),
});
