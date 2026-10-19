import { z } from "zod";

export type AuthMode = "login" | "signup" | "recovery";

/** Same rule the old client enforced: 8+ characters with a number and a non-alphanumeric character. */
export const passwordRules = [
  { id: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { id: "number", label: "A number", test: (value: string) => /\d/.test(value) },
  { id: "symbol", label: "A special character", test: (value: string) => /[^A-Za-z0-9]/.test(value) }
] as const;

const username = z.string().trim().min(1, "Username is required.");

export const loginSchema = z.object({
  username,
  password: z.string().min(1, "Password is required.")
});

export const signupSchema = z
  .object({
    username,
    password: z
      .string()
      .refine((value) => passwordRules.every((rule) => rule.test(value)), {
        message: "Password must be 8+ characters and include a number and special character."
      }),
    confirmPassword: z.string()
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match."
  });

export const recoverySchema = z.object({
  username,
  recoveryCode: z.string().trim().min(1, "Recovery code is required.")
});

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
export type RecoveryValues = z.infer<typeof recoverySchema>;
