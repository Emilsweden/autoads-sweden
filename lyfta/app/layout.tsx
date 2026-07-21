import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import CookieBanner from "@/components/CookieBanner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lyfta.se";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "LYFTA – Kreatin för kvinnor | Förhandsboka med 20 % rabatt",
  description:
    "Kreatin monohydrat framtaget för kvinnor – för styrka, återhämtning och energi. Utan tillsatser. Förhandsboka nu och lås 20 % rabatt på din första månad.",
  keywords: [
    "kreatin för kvinnor",
    "kreatin monohydrat",
    "kosttillskott kvinnor",
    "styrketräning kvinnor",
    "LYFTA",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    title: "LYFTA – Styrka är kvinnligt.",
    description:
      "Kreatin monohydrat framtaget för kvinnor. Förhandsboka nu och lås 20 % rabatt på din första månad.",
    url: siteUrl,
    siteName: "LYFTA",
    locale: "sv_SE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LYFTA – Styrka är kvinnligt.",
    description:
      "Kreatin monohydrat framtaget för kvinnor. Förhandsboka nu och lås 20 % rabatt.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv" className={`${inter.variable} ${playfair.variable}`}>
      <head>
        {/*
          ── Meta Pixel (platshållare) ────────────────────────────────
          Avkommentera och ersätt DIN_PIXEL_ID när du är redo att aktivera.
          OBS: Aktivera först efter att samtycke inhämtats via cookiebannern.

        <script
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', 'DIN_PIXEL_ID');
              fbq('track', 'PageView');
            `,
          }}
        />
        */}

        {/*
          ── TikTok Pixel (platshållare) ──────────────────────────────
          Avkommentera och ersätt DIN_TIKTOK_PIXEL_ID när du är redo.
          OBS: Aktivera först efter att samtycke inhämtats via cookiebannern.

        <script
          dangerouslySetInnerHTML={{
            __html: `
              !function (w, d, t) {
                w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)}(window, document, 'ttq');
                ttq.load('DIN_TIKTOK_PIXEL_ID');
                ttq.page();
              }(window, document, 'ttq');
            `,
          }}
        />
        */}
      </head>
      <body>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
