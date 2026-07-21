import AnnouncementBar from "@/components/AnnouncementBar";
import Hero from "@/components/Hero";
import TrustBar from "@/components/TrustBar";
import Benefits from "@/components/Benefits";
import HowItWorks from "@/components/HowItWorks";
import Pricing from "@/components/Pricing";
import Faq from "@/components/Faq";
import SignupSection from "@/components/SignupSection";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main>
      <AnnouncementBar />
      <Hero />
      <TrustBar />
      <Benefits />
      <HowItWorks />
      <Pricing />
      <Faq />
      <SignupSection />
      <Footer />
    </main>
  );
}
