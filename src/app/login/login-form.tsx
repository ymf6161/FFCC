"use client";

import { useActionState } from "react";
import { devLogin, type LoginState } from "@/auth/actions";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(devLogin, { error: null });
  return (
    <form action={action} className="mt-5">
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Continue as the demo household"}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-3 text-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
