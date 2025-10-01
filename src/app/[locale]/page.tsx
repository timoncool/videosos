import LandingHeader from "@/components/landing-header";
import LandingHero from "@/components/landing-hero";
import LandingFeatures from "@/components/landing-features";
import LandingCommunity from "@/components/landing-community";
import LandingFooter from "@/components/landing-footer";

export default function LandingPage() {
  return (
    <>
      <LandingHeader />
      <main>
        <LandingHero />
        <LandingFeatures />
        <LandingCommunity />
      </main>
      <LandingFooter />
    </>
  );
}
