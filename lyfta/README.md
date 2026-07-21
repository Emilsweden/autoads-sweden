# LYFTA – förhandsbokningssida

Landningssida för förhandsbokning av LYFTA, ett svenskt kreatinvarumärke för
kvinnor. Byggd med Next.js 14 (App Router) och Tailwind CSS. Mobile-first,
SEO-optimerad på svenska och deploy-redo för Vercel.

## Kom igång lokalt

```bash
cd lyfta
npm install
cp .env.example .env.local   # fyll i värden (se nedan)
npm run dev
```

Öppna [http://localhost:3000](http://localhost:3000).

Utan konfigurerad leverantör loggas leads bara till serverkonsolen – bra för
att testa formuläret lokalt.

## Konfigurera lead-insamling

Formuläret postar till `app/api/subscribe/route.ts`, som styrs via miljövariabler
(se `.env.example`). Välj **en** leverantör:

### Alternativ A: Resend (rekommenderas)

1. Skapa ett konto på [resend.com](https://resend.com) och en API-nyckel.
2. Skapa en **Audience** under *Audiences* och kopiera dess ID.
3. Sätt:
   ```
   LEAD_PROVIDER=resend
   RESEND_API_KEY=re_xxxx
   RESEND_AUDIENCE_ID=xxxx-xxxx
   ```
4. Valfritt – få en notis per lead: verifiera din domän i Resend och sätt
   `LEAD_NOTIFY_EMAIL` (dit notisen skickas) och `LEAD_FROM_EMAIL`
   (verifierad avsändare).

### Alternativ B: Formspree (enklast)

1. Skapa ett formulär på [formspree.io](https://formspree.io) och kopiera
   formulär-ID:t (t.ex. `mqkvabcd`).
2. Sätt:
   ```
   LEAD_PROVIDER=formspree
   FORMSPREE_FORM_ID=mqkvabcd
   ```

## Deploya till Vercel

1. Pusha repot till GitHub.
2. Gå till [vercel.com/new](https://vercel.com/new) och importera repot.
3. **Viktigt:** sätt **Root Directory** till `lyfta` (appen ligger i en
   undermapp av repot).
4. Lägg in miljövariablerna under *Settings → Environment Variables*
   (samma nycklar som i `.env.example`, inklusive `NEXT_PUBLIC_SITE_URL`
   med din riktiga domän).
5. Klicka **Deploy**. Klart – varje push till main deployas automatiskt.

Alternativt via CLI:

```bash
npm i -g vercel
cd lyfta
vercel          # första gången: koppla projektet, sätt root till denna mapp
vercel --prod
```

## Aktivera Meta Pixel / TikTok Pixel

Platshållare finns bortkommenterade i `app/layout.tsx`:

1. Avkommentera respektive `<script>`-block.
2. Ersätt `DIN_PIXEL_ID` / `DIN_TIKTOK_PIXEL_ID` med dina riktiga ID:n.
3. **GDPR:** ladda pixlarna först efter samtycke. Cookiebannern
   (`components/CookieBanner.tsx`) sparar valet i `localStorage` under nyckeln
   `lyfta-cookie-consent` (`"accepted"` / `"declined"`) – villkora
   pixel-laddningen på det värdet.

## Struktur

```
lyfta/
├── app/
│   ├── layout.tsx              # Fonter, metadata (SEO), pixel-platshållare
│   ├── page.tsx                # Landningssidan (alla sektioner)
│   ├── globals.css
│   ├── integritetspolicy/      # GDPR-sida
│   ├── api/subscribe/route.ts  # Lead-API (Resend/Formspree/logg)
│   ├── robots.ts
│   └── sitemap.ts
└── components/                 # En komponent per sektion + formulär, cookiebanner
```

## Innehållsnoteringar

- Hälsopåståendet under "Ökad styrka" följer EFSA:s godkända formulering för
  kreatin. Lägg inte till ytterligare medicinska påståenden utan att stämma av
  mot EFSA:s register.
- Texten om leverans ("vecka 35") och priser (249 kr/mån, 299 kr engångsköp)
  uppdateras i respektive komponent under `components/`.
