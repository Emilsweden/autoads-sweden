const items = [
  "Tillverkat i EU",
  "Veganskt",
  "Tredjepartstestat",
  "Fri frakt över 499 kr",
];

export default function TrustBar() {
  return (
    <section className="border-y border-sage/20 bg-sage-light/60">
      <ul className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-6 py-4 text-sm text-sage-dark">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sage">
              ✓
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
