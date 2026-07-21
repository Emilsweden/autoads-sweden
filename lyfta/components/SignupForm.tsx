"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "success" | "error";

export default function SignupForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="mt-8 rounded-2xl border border-sage/40 bg-sage-light/60 px-6 py-8"
      >
        <p className="font-serif text-2xl text-ink">Tack – din plats är reserverad!</p>
        <p className="mt-2 text-stone">
          Vi hör av oss innan leverans vecka 35. Din 20&nbsp;% rabatt är låst.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="email" className="sr-only">
          E-postadress
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="din@epost.se"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full flex-1 rounded-full border border-sage/40 bg-white px-6 py-4 text-ink placeholder:text-stone/60 focus:border-sage focus:outline-none focus:ring-2 focus:ring-sage/30"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-full bg-terracotta px-8 py-4 font-medium text-cream transition-colors hover:bg-terracotta-dark disabled:opacity-60"
        >
          {status === "loading" ? "Skickar…" : "Lås din rabatt"}
        </button>
      </div>
      {status === "error" && (
        <p role="alert" className="mt-3 text-sm text-terracotta-dark">
          Något gick fel – försök igen om en stund.
        </p>
      )}
    </form>
  );
}
