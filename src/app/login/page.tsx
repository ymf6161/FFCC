import { devLoginEnabled } from "@/auth/token";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const enabled = devLoginEnabled();
  const { expired } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="font-display text-[2.5rem] font-extrabold leading-none tracking-[-0.03em]">ffcc</p>
      <h1 className="type-title mt-6">Sign in</h1>
      {expired === "1" ? (
        <p role="status" className="mt-3 text-muted-foreground">
          Your sign-in has expired. Please sign in again.
        </p>
      ) : null}
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
