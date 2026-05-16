import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isLoggedIn()) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  return (
    <main className="page" style={{ maxWidth: 460 }}>
      <h1>CEO Login</h1>
      <p>Sign in with the admin username and password from Vercel environment variables.</p>

      <form method="post" action="/api/auth/login" className="card grid">
        <label className="grid" style={{ gap: 6 }}>
          <span>Username</span>
          <input className="input" type="text" name="username" autoFocus required />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span>Password</span>
          <input className="input" type="password" name="password" required />
        </label>
        <button type="submit">Sign In</button>
      </form>

      {params.error ? <p style={{ color: "#b91c1c" }}>Invalid username or password.</p> : null}
    </main>
  );
}
