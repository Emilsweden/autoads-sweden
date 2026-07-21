import SignupForm from "@/components/SignupForm";

export default function SignupSection() {
  return (
    <section id="forhandsboka" className="px-6 py-20 sm:py-28 scroll-mt-8">
      <div className="mx-auto max-w-xl text-center">
        <h2 className="font-serif text-3xl sm:text-4xl text-ink">
          Bli en av de första 100 – lås din 20&nbsp;% rabatt
        </h2>
        <p className="mt-4 text-stone leading-relaxed">
          Lämna din e-postadress så reserverar vi din rabatt. Ingen betalning
          nu – du bestämmer först när vi skickar.
        </p>
        <SignupForm />
        <p className="mt-4 text-xs text-stone">
          Vi använder din e-post enbart för att kontakta dig om LYFTA-lanseringen.
          Läs mer i vår{" "}
          <a
            href="/integritetspolicy"
            className="underline underline-offset-2 hover:text-ink"
          >
            integritetspolicy
          </a>
          .
        </p>
      </div>
    </section>
  );
}
