const steps = [
  {
    title: "Reservera gratis idag",
    text: "Lämna din e-postadress – ingen betalning och inga kortuppgifter.",
  },
  {
    title: "Vi skickar vecka 35",
    text: "Din första leverans går ut i slutet av augusti, direkt hem i brevlådan.",
  },
  {
    title: "Betalning startar först vid leverans",
    text: "Betalning och prenumeration startar först när din första leverans skickas.",
  },
];

export default function HowItWorks() {
  return (
    <section className="bg-sage-light/40 px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-4xl">
        <h2 className="font-serif text-3xl sm:text-4xl text-center text-ink">
          Så funkar det
        </h2>
        <ol className="mt-12 grid gap-10 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-sage bg-cream font-serif text-lg text-sage-dark">
                {index + 1}
              </span>
              <h3 className="mt-4 font-medium text-ink">{step.title}</h3>
              <p className="mt-2 text-sm text-stone leading-relaxed">
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
