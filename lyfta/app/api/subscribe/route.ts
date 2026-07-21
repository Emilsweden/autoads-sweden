import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email: unknown;
  try {
    ({ email } = await request.json());
  } catch {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }

  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    return NextResponse.json(
      { error: "Ange en giltig e-postadress." },
      { status: 400 }
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  const provider = process.env.LEAD_PROVIDER;

  try {
    if (provider === "resend") {
      await saveWithResend(cleanEmail);
    } else if (provider === "formspree") {
      await saveWithFormspree(cleanEmail);
    } else {
      // Ingen leverantör konfigurerad – logga bara (utvecklingsläge).
      console.log(`[lead] ${cleanEmail}`);
    }
  } catch (error) {
    console.error("Kunde inte spara lead:", error);
    return NextResponse.json(
      { error: "Något gick fel. Försök igen om en stund." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}

async function saveWithResend(email: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY saknas");

  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (audienceId) {
    const res = await fetch(
      `https://api.resend.com/audiences/${audienceId}/contacts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, unsubscribed: false }),
      }
    );
    if (!res.ok) {
      throw new Error(`Resend contacts svarade ${res.status}: ${await res.text()}`);
    }
  }

  const notifyEmail = process.env.LEAD_NOTIFY_EMAIL;
  const fromEmail = process.env.LEAD_FROM_EMAIL;
  if (notifyEmail && fromEmail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: "Ny LYFTA-förhandsbokning",
        text: `Ny lead: ${email}`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend emails svarade ${res.status}: ${await res.text()}`);
    }
  }

  if (!audienceId && !(notifyEmail && fromEmail)) {
    throw new Error(
      "Resend är valt men varken RESEND_AUDIENCE_ID eller LEAD_NOTIFY_EMAIL/LEAD_FROM_EMAIL är satta"
    );
  }
}

async function saveWithFormspree(email: string) {
  const formId = process.env.FORMSPREE_FORM_ID;
  if (!formId) throw new Error("FORMSPREE_FORM_ID saknas");

  const res = await fetch(`https://formspree.io/f/${formId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    throw new Error(`Formspree svarade ${res.status}: ${await res.text()}`);
  }
}
