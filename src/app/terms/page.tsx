import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Coaster',
  description: 'Terms governing your use of the Coaster mindful standard drink unit ledger.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto rounded-3xl bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm p-6 sm:p-10 space-y-6">
        <div className="space-y-2 border-b border-[#E8DFD1] pb-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#C26D2D]">
            Coaster Legal
          </p>
          <h1 className="text-3xl font-black tracking-tight">Terms of Service</h1>
          <p className="text-xs text-[#6E6359]">Effective November 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold">1. Mindful Journal, Not Medical Advice</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            Coaster helps you log drinks in NIAAA Standard Drink Units (14g / 0.6 fl oz of pure
            alcohol) and spot personal patterns over time. Coaster and Sunny do not provide medical
            diagnosis, clinical treatment, or alcohol dependency counseling.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">2. Never Use to Judge Driving Safety</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            Coaster does not measure Blood Alcohol Concentration (BAC) or cognitive impairment. Do
            not rely on Coaster logs or unit math to decide whether you are safe to drive or operate
            machinery.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">3. Your Data &amp; Account</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            You retain ownership of the pour logs, notes, and shared links you create. We ask that
            you share links responsibly and avoid posting unlawful content through OS share targets
            or shared round cards.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">4. Availability</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            Coaster is provided &ldquo;as is&rdquo; without warranties of uninterrupted availability.
            You may export or permanently delete your account at any time from Preferences.
          </p>
        </section>

        <div className="pt-4 border-t border-[#E8DFD1] flex items-center justify-between text-xs font-semibold text-[#6E6359]">
          <Link href="/" className="hover:text-[#1F1B18] underline underline-offset-4">
            Back to Coaster
          </Link>
          <Link href="/privacy" className="hover:text-[#1F1B18] underline underline-offset-4">
            Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
