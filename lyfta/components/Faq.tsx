const faqs = [
  {
    question: "Är kreatin säkert för kvinnor?",
    answer:
      "Ja. Kreatin monohydrat är ett av världens mest studerade kosttillskott och används av både kvinnor och män. LYFTA innehåller 5 g rent kreatin monohydrat per dagsdos – utan tillsatser. Är du gravid, ammar eller har en medicinsk fråga rekommenderar vi att du pratar med läkare först.",
  },
  {
    question: "Blir jag bulkig?",
    answer:
      "Nej. Kreatin bygger inte muskler av sig självt – det stödjer din prestationsförmåga vid högintensiv träning. En eventuell liten viktförändring i början beror på att musklerna binder mer vätska, inte på ökad muskelmassa.",
  },
  {
    question: "När dras pengarna?",
    answer:
      "Ingenting dras när du förhandsbokar. Betalningen sker först när din första leverans skickas, vecka 35. Du får ett mejl innan så att du kan ändra eller avbryta.",
  },
  {
    question: "Kan jag avsluta när som helst?",
    answer:
      "Ja. Prenumerationen har ingen bindningstid – du pausar eller avslutar när du vill med ett klick, utan frågor.",
  },
];

export default function Faq() {
  return (
    <section className="bg-sage-light/40 px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-2xl">
        <h2 className="font-serif text-3xl sm:text-4xl text-center text-ink">
          Vanliga frågor
        </h2>
        <div className="mt-10 divide-y divide-sage/20">
          {faqs.map((faq) => (
            <details key={faq.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium text-ink [&::-webkit-details-marker]:hidden">
                {faq.question}
                <span
                  aria-hidden="true"
                  className="text-sage-dark transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-stone leading-relaxed">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
