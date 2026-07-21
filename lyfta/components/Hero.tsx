export default function Hero() {
  return (
    <section className="px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
      <div className="mx-auto max-w-3xl">
        <p className="font-sans text-sm uppercase tracking-[0.3em] text-sage-dark mb-6">
          LYFTA
        </p>
        <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl leading-[1.05] text-ink">
          Styrka är kvinnligt.
        </h1>
        <p className="mt-6 mx-auto max-w-xl text-lg sm:text-xl text-stone leading-relaxed">
          Kreatin monohydrat framtaget för kvinnor – för styrka, återhämtning
          och energi. Utan tillsatser.
        </p>
        <div className="mt-10">
          <a
            href="#forhandsboka"
            className="inline-block rounded-full bg-terracotta px-8 py-4 text-cream font-medium tracking-wide shadow-sm transition-colors hover:bg-terracotta-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            Lås din rabatt
          </a>
        </div>
        <p className="mt-4 text-sm text-stone">
          Gratis att reservera · Ingen betalning nu
        </p>
      </div>
    </section>
  );
}
