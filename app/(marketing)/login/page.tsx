"use client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  if (sent) {
    return <p className="p-8">Check your email for the login link.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="p-8 max-w-sm">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="border-default border rounded px-3 py-2 w-full mb-3"
      />
      <button type="submit" className="bg-[var(--accent)] text-white rounded px-4 py-2 w-full">
        Send login link
      </button>
    </form>
  );
}