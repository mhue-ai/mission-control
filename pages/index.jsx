import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";

// Dynamic import prevents SSR for the dashboard (it's fully client-side)
const MissionControl = dynamic(() => import("../components/MissionControl"), {
  ssr: false,
  loading: () => (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0a0c10", color: "#5a6070", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🦞</div>
        <div style={{ fontSize: 13 }}>Loading Mission Control...</div>
      </div>
    </div>
  ),
});

export default function Home() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if we have a valid session
    fetch("/api/fleet", { credentials: "include" })
      .then((res) => {
        if (res.ok) {
          setAuthed(true);
        } else {
          router.replace("/login");
        }
      })
      .catch(() => router.replace("/login"))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0a0c10", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#5a6070", fontSize: 13 }}>Checking session...</div>
      </div>
    );
  }

  if (!authed) return null;

  return <MissionControl />;
}
