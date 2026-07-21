import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integritetspolicy | LYFTA",
  description:
    "Så hanterar LYFTA dina personuppgifter: vad din e-postadress används till, hur länge den sparas och hur du avregistrerar dig.",
  robots: { index: true, follow: true },
};

export default function IntegritetspolicyPage() {
  return (
    <main className="px-6 py-16 sm:py-24">
      <article className="mx-auto max-w-2xl">
        <a
          href="/"
          className="text-sm text-stone underline-offset-2 hover:text-ink hover:underline"
        >
          ← Tillbaka till startsidan
        </a>
        <h1 className="mt-6 font-serif text-4xl text-ink">Integritetspolicy</h1>
        <p className="mt-2 text-sm text-stone">Senast uppdaterad: juli 2026</p>

        <div className="mt-8 space-y-8 text-stone leading-relaxed">
          <section>
            <h2 className="font-serif text-2xl text-ink">Vilka uppgifter vi samlar in</h2>
            <p className="mt-3">
              När du förhandsbokar LYFTA sparar vi endast din e-postadress. Vi
              samlar inte in namn, betalningsuppgifter eller andra
              personuppgifter i samband med förhandsbokningen.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Vad e-postadressen används till</h2>
            <p className="mt-3">
              Din e-postadress används enbart för att kontakta dig om
              LYFTA-lanseringen: bekräfta din reservation, meddela när leveransen
              närmar sig (vecka 35) och ge dig möjlighet att aktivera din rabatt.
              Vi säljer aldrig din e-postadress vidare och delar den inte med
              tredje part för deras marknadsföring.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Rättslig grund och lagringstid</h2>
            <p className="mt-3">
              Behandlingen sker med stöd av ditt samtycke (art. 6.1 a GDPR), som
              du lämnar när du skickar in formuläret. Vi sparar din e-postadress
              tills lanseringen är genomförd eller tills du avregistrerar dig –
              beroende på vad som inträffar först.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Hur du avregistrerar dig</h2>
            <p className="mt-3">
              Du kan när som helst återkalla ditt samtycke och få din
              e-postadress raderad. Klicka på avregistreringslänken i något av
              våra mejl, eller mejla oss på{" "}
              <a
                href="mailto:hej@lyfta.se"
                className="text-terracotta underline-offset-2 hover:underline"
              >
                hej@lyfta.se
              </a>{" "}
              så raderar vi dina uppgifter utan dröjsmål.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Cookies</h2>
            <p className="mt-3">
              Vi använder endast nödvändiga cookies för att sajten ska fungera,
              samt – om du godkänner det i cookiebannern –
              marknadsföringscookies (t.ex. Meta Pixel och TikTok Pixel) för att
              mäta våra annonser. Du kan neka marknadsföringscookies utan att
              det påverkar din möjlighet att förhandsboka.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Dina rättigheter</h2>
            <p className="mt-3">
              Enligt GDPR har du rätt att begära tillgång till, rättelse av
              eller radering av dina personuppgifter, samt att inge klagomål
              till Integritetsskyddsmyndigheten (IMY). Kontakta oss på{" "}
              <a
                href="mailto:hej@lyfta.se"
                className="text-terracotta underline-offset-2 hover:underline"
              >
                hej@lyfta.se
              </a>{" "}
              för alla frågor om dina uppgifter.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
