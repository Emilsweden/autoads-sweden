export default function Pricing() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-4xl">
        <h2 className="font-serif text-3xl sm:text-4xl text-center text-ink">
          Välj det som passar dig
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 sm:items-stretch">
          {/* Prenumeration – framhävd */}
          <div className="relative flex flex-col rounded-2xl border-2 border-sage bg-white p-8 shadow-sm">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-sage px-4 py-1 text-xs font-medium uppercase tracking-wider text-cream">
              Mest populär
            </span>
            <h3 className="font-serif text-2xl text-ink">Prenumeration</h3>
            <p className="mt-4">
              <span className="font-serif text-5xl text-ink">249 kr</span>
              <span className="text-stone">/mån</span>
            </p>
            <ul className="mt-6 space-y-2 text-stone">
              <li>En månads förbrukning (30 × 5 g)</li>
              <li>Fri frakt, direkt i brevlådan</li>
              <li>Avsluta när du vill</li>
              <li>20&nbsp;% rabatt första månaden vid förhandsbokning</li>
            </ul>
            <a
              href="#forhandsboka"
              className="mt-8 inline-block rounded-full bg-terracotta px-6 py-3 text-center text-cream font-medium transition-colors hover:bg-terracotta-dark"
            >
              Förhandsboka med rabatt
            </a>
          </div>

          {/* Engångsköp */}
          <div className="flex flex-col rounded-2xl border border-sage/20 bg-white/60 p-8">
            <h3 className="font-serif text-2xl text-ink">Engångsköp</h3>
            <p className="mt-4">
              <span className="font-serif text-5xl text-ink">299 kr</span>
            </p>
            <ul className="mt-6 space-y-2 text-stone">
              <li>En månads förbrukning (30 × 5 g)</li>
              <li>Ingen bindning, inget konto</li>
              <li>Testa i din egen takt</li>
            </ul>
            <a
              href="#forhandsboka"
              className="mt-auto pt-8 text-center text-terracotta font-medium underline-offset-4 hover:underline"
            >
              Förhandsboka utan prenumeration
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
