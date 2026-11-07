import { describe, expect, test } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@/lib/auth/schemas";

/** Senhas derivadas da regra real, pra teste e app nunca desalinharem. */
const SENHA_VALIDA = "a".repeat(PASSWORD_MIN_LENGTH);
const SENHA_CURTA = "a".repeat(PASSWORD_MIN_LENGTH - 1);

describe("signUpSchema", () => {
  test("accepts valid input", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: SENHA_VALIDA,
      fullName: "Fulano",
    });
    expect(result.success).toBe(true);
  });

  test("rejects short password", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: SENHA_CURTA,
      fullName: "Fulano",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid email", () => {
    const result = signUpSchema.safeParse({
      email: "not-an-email",
      password: SENHA_VALIDA,
      fullName: "Fulano",
    });
    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  test("requires password", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  test("accepts valid email", () => {
    expect(resetPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
});

describe("updatePasswordSchema", () => {
  test("rejects mismatched passwords", () => {
    const result = updatePasswordSchema.safeParse({
      password: SENHA_VALIDA,
      confirmPassword: "different",
    });
    expect(result.success).toBe(false);
  });

  test("accepts matching passwords", () => {
    const result = updatePasswordSchema.safeParse({
      password: SENHA_VALIDA,
      confirmPassword: SENHA_VALIDA,
    });
    expect(result.success).toBe(true);
  });
});
