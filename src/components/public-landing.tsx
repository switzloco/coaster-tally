'use client';

import React from 'react';
import Link from 'next/link';
import {
  Beer,
  Wine,
  Martini,
  Leaf,
  Sparkles,
  MessageCircle,
  Camera,
  Mic,
  Mail,
  ShieldCheck,
  Cpu,
  Lock,
  ArrowRight,
  Sunrise,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OutreachEnrollmentCard } from '@/components/outreach-enrollment-card';

interface PublicLandingProps {
  onLogin: () => void;
  onAnonymousLogin: () => void;
  isLoggingIn: boolean;
}

export function PublicLanding({
  onLogin,
  onAnonymousLogin,
  isLoggingIn,
}: PublicLandingProps) {
  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] flex flex-col">
      {/* Top Navigation */}
      <nav className="px-4 sm:px-6 py-3.5 flex items-center justify-between bg-[#FFFDF9]/85 backdrop-blur-md border-b border-[#E8DFD1] sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#C26D2D] text-[#FFFDF9] flex items-center justify-center shadow-sm ring-4 ring-[#C26D2D]/15">
            <Sunrise className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight leading-none text-[#1F1B18] font-['Newsreader',Georgia,serif]">
              Coaster
            </h1>
            <p className="text-[11px] font-medium text-[#6E6359] mt-0.5">
              Mindful Drink Tally · with Sunny
            </p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6">
          <Link
            href="#story"
            className="text-xs font-medium text-[#6E6359] hover:text-[#1F1B18] transition-colors"
          >
            A New Journey
          </Link>
          <Link
            href="#units"
            className="text-xs font-medium text-[#6E6359] hover:text-[#1F1B18] transition-colors"
          >
            Standard Units
          </Link>
          <Link
            href="#features"
            className="text-xs font-medium text-[#6E6359] hover:text-[#1F1B18] transition-colors"
          >
            Hybrid AI &amp; Email
          </Link>
          <Link
            href="/briefings"
            className="text-xs font-medium text-[#6E6359] hover:text-[#1F1B18] transition-colors"
          >
            Check-Ins
          </Link>
          <Button
            size="sm"
            className="rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] font-medium text-xs h-9 px-4 shadow-sm"
            onClick={onAnonymousLogin}
            disabled={isLoggingIn}
          >
            Open Your Coaster
          </Button>
        </div>

        <Button
          size="sm"
          className="md:hidden rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] font-medium text-xs h-9 px-3.5"
          onClick={onAnonymousLogin}
          disabled={isLoggingIn}
        >
          Open Coaster
        </Button>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-14 pb-20 sm:pt-20 sm:pb-24 px-4 sm:px-6 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -left-24 w-80 h-80 bg-[#D97706]/10 rounded-full blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 bg-[#3F7D58]/10 rounded-full blur-3xl" />

        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] text-[#9A4E16] shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#D97706]" />
            <span className="text-xs font-medium tracking-wide">
              NIAAA Standard Drink Units · Hybrid AI Privacy
            </span>
          </div>

          <div className="space-y-4">
            <h2 className="text-4xl sm:text-6xl font-semibold tracking-tight text-[#1F1B18] leading-[1.08] font-['Newsreader',Georgia,serif]">
              An honest coaster under your glass,{' '}
              <span className="text-[#C26D2D] italic">without the lecture.</span>
            </h2>
            <p className="text-base sm:text-xl text-[#6E6359] max-w-2xl mx-auto leading-relaxed">
              Tally pours by voice, chat, shorthand, bottle photo, or email reply. Notice your
              weekly rhythm, mark alcohol-free evenings in calm sage, and trade ideas with Sunny.
            </p>
          </div>

          {/* Guest entry leads cleanly so WebViews, PWAs, and browsers never block onboarding */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <Button
              data-testid="landing-guest-cta"
              className="h-14 px-8 rounded-2xl text-sm sm:text-base font-semibold bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] shadow-lg shadow-[#C26D2D]/15 group w-full sm:w-auto"
              onClick={onAnonymousLogin}
              disabled={isLoggingIn}
            >
              Continue to Your Coaster
              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-0.5 transition-transform" />
            </Button>
            <Button
              data-testid="landing-google-cta"
              variant="outline"
              className="h-14 px-7 rounded-2xl text-sm font-medium border border-[#E8DFD1] bg-[#FFFDF9] hover:bg-[#F5EFE6] text-[#1F1B18] w-full sm:w-auto"
              onClick={onLogin}
              disabled={isLoggingIn}
            >
              Sign In With Google
            </Button>
          </div>

          <p className="text-xs text-[#6E6359]">
            Start privately right away as a guest, or sign in with Google anytime to carry your
            coaster across devices.
          </p>

          <div className="pt-4 flex flex-wrap justify-center gap-6 text-xs font-medium text-[#6E6359]">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#3F7D58]" />
              <span>On-Device Gemini Nano Ready</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#C26D2D]" />
              <span>Privacy Vault Mode</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#D97706]" />
              <span>2-Way +coaster@ Email</span>
            </div>
          </div>
        </div>
      </section>

      {/* "A New Journey" Story Card */}
      <section id="story" className="px-4 sm:px-6 pb-16">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-[#FFFDF9] border-[#E8DFD1] rounded-3xl shadow-[0_6px_30px_rgba(31,27,24,0.05)] overflow-hidden">
            <CardContent className="p-6 sm:p-10 grid md:grid-cols-[1.3fr,0.9fr] gap-8 items-center">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#C26D2D]">
                  <Sunrise className="w-4 h-4" />
                  <span>A New Journey</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1F1B18] font-['Newsreader',Georgia,serif]">
                  Clarity instead of rules. Company instead of scorecards.
                </h3>
                <p className="text-sm sm:text-base text-[#4A4139] leading-relaxed">
                  Most drink trackers treat you like a problem to fix. Coaster starts from a kinder
                  place: starting fresh means simply noticing what is in your glass with warmth and
                  honesty—celebrating every pour tallied openly and every clear evening noticed
                  without fanfare or guilt.
                </p>
                <p className="text-sm sm:text-base text-[#4A4139] leading-relaxed">
                  Meet <strong className="font-semibold text-[#1F1B18]">Sunny</strong>, your
                  non-drinking booth-buddy at the end of the bar. Sunny nurses a sparkling yuzu or a
                  Phony Negroni, keeps score out of the room, appreciates gentle banter about overly
                  poetic IPA tap lists, and every now and then slides across a crisp zero-proof swap
                  worth trying.
                </p>
              </div>

              <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-[#3F7D58]/15 text-[#3F7D58] flex items-center justify-center font-semibold text-sm">
                    S
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1F1B18]">Sunny · Coaster</p>
                    <p className="text-xs text-[#6E6359]">Zero-judgment booth-buddy</p>
                  </div>
                </div>

                <div className="rounded-xl bg-[#FFFDF9] border border-[#E8DFD1] p-3.5 text-sm text-[#1F1B18] leading-relaxed">
                  &ldquo;Two hazy 16oz pints at trivia logged at{' '}
                  <span className="font-mono font-semibold text-[#C26D2D]">3.8u</span> total. Fun
                  fact: brewers keep naming IPAs like 19th-century clouds. Want a crisp non-alcoholic
                  hop water or yuzu tonic idea for round three?&rdquo;
                </div>

                <div className="flex items-center justify-between text-xs text-[#3F7D58] font-medium pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Leaf className="w-3.5 h-3.5" />
                    Clear evenings celebrated in sage
                  </span>
                  <span className="font-mono">0.0u</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* NIAAA Standard Drink Units Visual Section */}
      <section id="units" className="py-16 px-4 sm:px-6 bg-[#F4EDE2]/70 border-y border-[#E8DFD1]">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C26D2D]">
              One Honest Measure
            </p>
            <h3 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1F1B18] font-['Newsreader',Georgia,serif]">
              How NIAAA Standard Drink Units work
            </h3>
            <p className="text-sm sm:text-base text-[#6E6359] leading-relaxed">
              Every standard drink equals{' '}
              <span className="font-semibold text-[#1F1B18]">0.6 fl oz (14g)</span> of pure
              ethanol. A tall 7% pint isn&apos;t &ldquo;one beer,&rdquo; and Coaster quietly handles
              the oz-and-ABV math so your weekly trend actually tells the truth.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: <Beer className="w-6 h-6 text-[#C26D2D]" />,
                title: '12 oz · 5% Beer = 1.0u',
                subtitle: 'Lager, Pilsner, or Seltzer',
                detail:
                  'A standard 12oz can at 5% ABV is 1.0u. A 16oz 7.2% craft hazy IPA works out to 1.9u.',
              },
              {
                icon: <Wine className="w-6 h-6 text-[#C26D2D]" />,
                title: '5 oz · 12% Wine = 1.0u',
                subtitle: 'Table Wine & Bubbles',
                detail:
                  'A modest 5oz glass at 12% ABV is 1.0u. A generous 6oz restaurant pour of 14.5% cabernet is 1.5u.',
              },
              {
                icon: <Martini className="w-6 h-6 text-[#C26D2D]" />,
                title: '1.5 oz · 40% Spirit = 1.0u',
                subtitle: 'Neat, Rocks, or Cocktails',
                detail:
                  'A 1.5oz jigger of 80-proof whiskey, tequila, or gin is 1.0u. Spirit-forward cocktails typically run 1.5u–2.0u.',
              },
            ].map((card) => (
              <Card
                key={card.title}
                className="bg-[#FFFDF9] border-[#E8DFD1] rounded-2xl shadow-sm"
              >
                <CardContent className="p-6 space-y-3">
                  <div className="w-11 h-11 rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] flex items-center justify-center">
                    {card.icon}
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-[#1F1B18] font-mono">
                      {card.title}
                    </h4>
                    <p className="text-xs font-medium text-[#C26D2D] mt-0.5">{card.subtitle}</p>
                  </div>
                  <p className="text-sm text-[#6E6359] leading-relaxed">{card.detail}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="rounded-2xl bg-[#EAF3ED] border border-[#3F7D58]/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Leaf className="w-5 h-5 text-[#3F7D58] shrink-0" />
              <p className="text-sm text-[#1F1B18]">
                <strong className="font-semibold text-[#2B5C3F]">Clear Days &amp; Zero-Proof Swaps (0.0u):</strong>{' '}
                Tap once to mark an alcohol-free day or swap in a botanical spritz—both light up your
                calendar in calm sage green.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Email Companion Enrollment Card */}
      <OutreachEnrollmentCard />

      {/* Features: Hybrid AI + Multi-Modal Inputs */}
      <section id="features" className="py-16 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C26D2D]">
              Built for Real Evenings
            </p>
            <h3 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1F1B18] font-['Newsreader',Georgia,serif]">
              Log from anywhere, keep what matters private
            </h3>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="bg-[#FFFDF9] border-[#E8DFD1] rounded-2xl">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-[#C26D2D]">
                  <MessageCircle className="w-5 h-5" />
                  <Mic className="w-4 h-4" />
                  <Camera className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-[#1F1B18]">Every Input Method</h4>
                <p className="text-sm text-[#6E6359] leading-relaxed">
                  Type plain English to Sunny, use Hybrid Shorthand (&ldquo;2x 12oz 5%&rdquo;,
                  &ldquo;half bottle cab&rdquo;), dictate by voice, tap 1-tap presets, or scan cans
                  and bar menus.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#FFFDF9] border-[#E8DFD1] rounded-2xl">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-[#3F7D58]">
                  <ShieldCheck className="w-5 h-5" />
                  <Cpu className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-[#1F1B18]">
                  On-Device Hybrid AI Privacy
                </h4>
                <p className="text-sm text-[#6E6359] leading-relaxed">
                  Powered by Firebase Hybrid AI &amp; Chrome Gemini Nano. Keep quick tallies locally on
                  your device with Privacy Vault (<code>ONLY_ON_DEVICE</code>), or let Cloud Gemini
                  synthesize your 30-day trends.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#FFFDF9] border-[#E8DFD1] rounded-2xl">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-[#D97706]">
                  <TrendingUp className="w-5 h-5" />
                  <Mail className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-[#1F1B18]">
                  2-Way Email &amp; Calm Trends
                </h4>
                <p className="text-sm text-[#6E6359] leading-relaxed">
                  Get gentle morning &amp; evening email check-ins (2x daily) and simply reply with a
                  sentence or drink photo via dedicated <code>+coaster@</code> routing. No app-open
                  required.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 border-t border-[#E8DFD1] bg-[#FFFDF9] mt-auto">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="space-y-1">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <Sunrise className="w-4 h-4 text-[#C26D2D]" />
              <span className="font-semibold text-base text-[#1F1B18] font-['Newsreader',Georgia,serif]">
                Coaster
              </span>
            </div>
            <p className="text-xs text-[#6E6359]">
              Mindful Drink Tally &amp; Trend Buddy · Built for #BuildHybridAI
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-[#6E6359]">
            <Link href="/briefings" className="hover:text-[#1F1B18] transition-colors">
              Email Companion
            </Link>
            <Link href="/privacy" className="hover:text-[#1F1B18] transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-[#1F1B18] transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
