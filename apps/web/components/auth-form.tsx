"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password, callbackURL: "/dashboard" })
        : await authClient.signIn.email({ email, password, callbackURL: "/dashboard" });

      if (result.error) {
        setError(result.error.message ?? "Authentication failed");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit}>
      {isSignUp ? (
        <label>
          <span>Name</span>
          <input autoComplete="name" name="name" placeholder="Your name" required />
        </label>
      ) : null}

      <label>
        <span>Email</span>
        <input autoComplete="email" name="email" placeholder="you@company.com" required type="email" />
      </label>

      <label>
        <span>Password</span>
        <input
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={10}
          name="password"
          placeholder="At least 10 characters"
          required
          type="password"
        />
      </label>

      {error ? <p className="formError" role="alert">{error}</p> : null}

      <button className="primary authSubmit" disabled={pending} type="submit">
        {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="authSwitch">
        {isSignUp ? "Already have an account? " : "New to the platform? "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"}>
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
