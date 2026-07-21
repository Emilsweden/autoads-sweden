const benefits = [
  {
    title: "Ökad styrka",
    text: "Kreatin ökar den fysiska prestationsförmågan vid upprepad högintensiv träning.",
  },
  {
    title: "Snabbare återhämtning",
    text: "Fyll på musklernas energidepåer så att du är redo för nästa pass – dag efter dag.",
  },
  {
    title: "5 g rent kreatin monohydrat – inget annat",
    text: "En enda ingrediens. Inga sötningsmedel, inga fyllnadsmedel, inga tillsatser.",
  },
];

export default function Benefits() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <h2 className="font-serif text-3xl sm:text-4xl text-center text-ink">
          Därför LYFTA
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {benefits.map((benefit) => (
            <div
              key={benefit.title}
              className="rounded-2xl border border-sage/20 bg-white/60 p-8"
            >
              <h3 className="font-serif text-xl text-ink">{benefit.title}</h3>
              <p className="mt-3 text-stone leading-relaxed">{benefit.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
