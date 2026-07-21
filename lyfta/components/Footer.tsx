export default function Footer() {
  return (
    <footer className="border-t border-sage/20 px-6 py-10">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center text-sm text-stone sm:flex-row sm:justify-between sm:text-left">
        <p className="font-serif text-lg text-ink">LYFTA</p>
        <nav className="flex gap-6">
          <a
            href="/integritetspolicy"
            className="underline-offset-2 hover:text-ink hover:underline"
          >
            Integritetspolicy
          </a>
          <a
            href="#forhandsboka"
            className="underline-offset-2 hover:text-ink hover:underline"
          >
            Förhandsboka
          </a>
        </nav>
        <p>© {new Date().getFullYear()} LYFTA. Alla rättigheter förbehållna.</p>
      </div>
    </footer>
  );
}
