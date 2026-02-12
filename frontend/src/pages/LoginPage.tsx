import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const destination = location.state?.from ?? "/";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(destination, { replace: true });
    } catch (err: any) {
      const message = err?.response?.data?.error ?? "Invalid email or password";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      navigate("/", { replace: true });
    }
  }, [status, navigate]);

  if (status === "authenticated") {
    return null;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.35)",
        }}
      >
        <header style={{ marginBottom: 24 }}>
          <p style={{ margin: 0, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>
            Al Assaad Trade and Transport
          </p>
          <h1 style={{ margin: "4px 0 0" }}>Sign in</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Access the construction dashboard.</p>
        </header>

        <form onSubmit={handleSubmit} className="form-grid one-column" style={{ gap: 16 }}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
