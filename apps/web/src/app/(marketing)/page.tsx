import { LandingAgents } from "@/components/landing/agents";
import { LandingClosing } from "@/components/landing/closing";
import { LandingCompare } from "@/components/landing/compare";
import { LandingFaq } from "@/components/landing/faq";
import { LandingFooter } from "@/components/landing/footer";
import { LandingHero } from "@/components/landing/hero";
import { LandingHow } from "@/components/landing/how";
import { LandingNav } from "@/components/landing/nav";
import { LandingSlice } from "@/components/landing/slice";

export default function LandingPage() {
  return (
    <div className="landing-root min-h-screen bg-white">
      <LandingNav />

      <main>
        <LandingHero />
        <LandingSlice />
        <LandingAgents />
        <LandingHow />
        <LandingCompare />
        <LandingFaq />
        <LandingClosing />
      </main>
      <LandingFooter />
    </div>
  );
}

