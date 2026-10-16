import { devLoginEnabled } from "@/auth/token";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const enabled = devLoginEnabled();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.03em]">ffcc</p>
      <h1 className="type-title mt-6">Sign in</h1>
      <div className="mt-6 rounded-lg bg-card p-5">
        {enabled ? (
          <>
            <p className="text-muted-foreground">
              This is a demo sign-in for building and testing. It opens the demo household, which holds made-up data
              only.
            </p>
            <LoginForm />
          </>
        ) : (
          <p className="text-muted-foreground">Sign-in is not set up on this server yet.</p>
        )}
      </div>
    </main>
  );
}
