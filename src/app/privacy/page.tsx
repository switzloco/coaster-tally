import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Coaster',
  description:
    'How Coaster handles your drink ledger, Hybrid AI options, and account deletion rights.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto rounded-3xl bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm p-6 sm:p-10 space-y-6">
        <div className="space-y-2 border-b border-[#E8DFD1] pb-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#C26D2D]">
            Coaster Legal
          </p>
          <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-[#6E6359]">Effective November 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold">1. What Coaster Stores</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            When you create a Coaster account, we store your drink pours, Standard Drink Unit
            calculations, Clear Days, Zero-Proof swap tastes, timezone, and optional companion
            email check-in preferences inside your private Firebase Authentication &amp; Cloud
            Firestore space.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">2. Hybrid AI &amp; Privacy Vault</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            Coaster supports on-device Gemini Nano (<code className="text-[#1F1B18]">PREFER_ON_DEVICE</code>)
            so short drink entries and reflections stay right inside your browser whenever supported.
            Turning on <strong className="text-[#1F1B18]">Privacy Vault (ONLY_ON_DEVICE)</strong> in
            Preferences blocks AI prompts from leaving your device. Cloud features such as multi-month
            Ledger Q&amp;A, OS Share parsing, and companion emails use encrypted HTTPS transport to
            our server endpoints strictly to fulfill your request.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">3. Shared Pour Links</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            Creating a share card generates a public read-only link for that specific pour list so a
            friend can view or copy the round onto their own coaster. You can revoke any shared card
            at any time from Preferences or History.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">4. No Ad Tracking or Data Resale</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            Coaster never sells, rents, or shares your drink ledger with advertisers, data brokers, or
            third-party analytics networks.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">5. Export &amp; Permanent Deletion</h2>
          <p className="text-sm text-[#6E6359] leading-relaxed">
            You can export your complete ledger in CSV or JSON at any time, or permanently erase your
            account and all subcollections directly inside Preferences.
          </p>
        </section>

        <div className="pt-4 border-t border-[#E8DFD1] flex items-center justify-between text-xs font-semibold text-[#6E6359]">
          <Link href="/" className="hover:text-[#1F1B18] underline underline-offset-4">
            Back to Coaster
          </Link>
          <Link href="/terms" className="hover:text-[#1F1B18] underline underline-offset-4">
            Terms of Service
          </Link>
        </div>
      </div>
    </main>
  );
}
