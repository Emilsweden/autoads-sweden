"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "lyfta-cookie-consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  function respond(choice: "accepted" | "declined") {
    localStorage.setItem(STORAGE_KEY, choice);
    setVisible(false);
    // När marknadsföringspixlar (Meta/TikTok) aktiveras: ladda dem endast
    // om choice === "accepted".
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-2xl border border-sage/30 bg-white p-6 shadow-lg sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-stone leading-relaxed">
          Vi använder cookies för att förbättra din upplevelse och, om du
          godkänner, för marknadsföring. Läs mer i vår{" "}
          <a
            href="/integritetspolicy"
            className="underline underline-offset-2 hover:text-ink"
          >
            integritetspolicy
          </a>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => respond("declined")}
            className="rounded-full border border-sage/40 px-4 py-2 text-sm text-ink transition-colors hover:bg-sage-light"
          >
            Endast nödvändiga
          </button>
          <button
            onClick={() => respond("accepted")}
            className="rounded-full bg-sage px-4 py-2 text-sm text-cream transition-colors hover:bg-sage-dark"
          >
            Godkänn alla
          </button>
        </div>
      </div>
    </div>
  );
}
