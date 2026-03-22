import { useState } from "react";
import { useRouter } from "next/router";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        // Store token for WebSocket auth (cookie is set httpOnly by server)
        sessionStorage.setItem("mc_token", data.token);
        router.push("/");
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      setError("Connection error");
    }
    setLoading(false);
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0a0c10", color: "#d4d8e0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');`}</style>
      <div style={{ width: 360, padding: 32, background: "#11131a", border: "1px solid #1a1e2c", borderRadius: 16 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, #e85d24, #f2a623)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 12 }}>🦞</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#f0f2f5", margin: 0 }}>Mission Control</h1>
          <p style={{ fontSize: 12, color: "#5a6070", marginTop: 4 }}>OpenClaw Fleet Orchestrator</p>
        </div>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            autoFocus
            style={{ width: "100%", padding: "10px 14px", background: "#090b0f", border: "1px solid #1a1e2c", borderRadius: 8, color: "#d4d8e0", fontSize: 13, outline: "none", marginBottom: 12, boxSizing: "border-box" }}
          />
          {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</div>}
          <button
            type="submit"
            disabled={loading || !password}
            style={{ width: "100%", padding: "10px 14px", background: "#2a1508", border: "1px solid #4a2812", borderRadius: 8, color: "#e85d24", fontSize: 13, fontWeight: 500, cursor: loading ? "wait" : "pointer", opacity: loading || !password ? 0.5 : 1 }}
          >
            {loading ? "Authenticating..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
