import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.email) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-1 text-sm font-medium uppercase tracking-wide text-ink-muted">
          The Educated HomeBuyer
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-ink">Comment Copilot</h1>
        <p className="mb-6 text-sm text-ink-muted">
          Sign in with your allowlisted Google account to review the comment
          queue.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-btn bg-ink px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Sign in with Google
          </button>
        </form>
        <p className="mt-4 text-xs text-ink-muted">
          Access is limited to the addresses on the app allowlist. Reviewing a
          channel does not connect it, YouTube authorization is separate.
        </p>
      </div>
    </main>
  );
}
