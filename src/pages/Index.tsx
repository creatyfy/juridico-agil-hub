import LandingNavbar from '@/components/landing/LandingNavbar';
import HeroSection from '@/components/landing/HeroSection';
import MetricsBar from '@/components/landing/MetricsBar';
import FeaturesSection from '@/components/landing/FeaturesSection';
import HowItWorks from '@/components/landing/HowItWorks';
import PlansSection from '@/components/landing/PlansSection';
import CTASection from '@/components/landing/CTASection';
import LandingFooter from '@/components/landing/LandingFooter';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#040d1a]">
      <LandingNavbar />
      <HeroSection />
      <MetricsBar />
      <FeaturesSection />
      <HowItWorks />
      <PlansSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}
