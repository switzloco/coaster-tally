'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Sunrise,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  Leaf,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUser } from '@/firebase';
import {
  enrollPublicOutreachAction,
  updateMyOutreachSettingsAction,
} from '@/app/actions/outreach';
import type { OutreachCadence } from '@/lib/health-service';
import { SITE_URL } from '@/lib/site';

export function BriefingsEnrollView() {
  const { user } = useUser();

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [cadence, setCadence] = useState<OutreachCadence>('2x');
  const [morningHour, setMorningHour] = useState(9);
  const [nightHour, setNightHour] = useState(19);
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [enrolledResult, setEnrolledResult] = useState<{
    headline: string;
    body: string;
    deliveredNow?: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Keep America/Los_Angeles default
    }
  }, []);

  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user?.email, email]);

  const handleCopyShareLink = async () => {
    try {
      const shareUrl =
        typeof window !== 'undefined' ? `${window.location.origin}/briefings` : `${SITE_URL}/briefings`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const useCurrentUserUid =
        Boolean(user) && (!user?.email || cleanEmail === user.email.toLowerCase());

      let res: {
        success: boolean;
        error?: string;
        headline?: string;
        body?: string;
        deliveredNow?: boolean;
      };

      if (useCurrentUserUid && user) {
        const idToken = await user.getIdToken();
        res = await updateMyOutreachSettingsAction(idToken, {
          enabled: true,
          channel: 'email',
          cadence,
          email: cleanEmail,
          timezone,
          morningHour,
          nightHour,
          sendWelcomeNow: true,
        });
      } else {
        res = await enrollPublicOutreachAction({
          channel: 'email',
          email: cleanEmail,
          cadence,
          timezone,
          morningHour,
          nightHour,
          ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        });
      }

      if (!res.success) {
        setError(res.error || 'Could not activate Email Companion right now.');
        return;
      }

      setEnrolledResult({
        headline: res.headline || 'Welcome Email Sent',
        body:
          res.body ||
          'Your Morning & Evening check-ins are active. Reply directly via +coaster@ anytime.',
        deliveredNow: res.deliveredNow,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-[#E8DFD1] bg-[#FFFDF9]/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#C26D2D] text-[#FFFDF9] flex items-center justify-center shadow-xs">
              <Sunrise className="w-4 h-4" />
            </div>
            <div>
              <span className="text-lg font-semibold tracking-tight font-['Newsreader',Georgia,serif]">
                Coaster
              </span>
              <span className="hidden sm:inline text-xs font-medium text-[#6E6359] ml-2">
                2-Way Email Companion
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyShareLink}
              className="rounded-xl text-xs font-medium text-[#6E6359] hover:text-[#1F1B18] gap-1.5"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#3F7D58]" />
                  Copied Link
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Share Page
                </>
              )}
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-xl text-xs font-semibold border-[#E8DFD1] bg-[#FFFDF9]"
            >
              <Link href="/">
                Open Coaster
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 md:py-14">
        <div className="grid lg:grid-cols-12 gap-8 md:gap-10 items-start">
          {/* Left Pitch & Sample Dispatches */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EAF3ED] border border-[#3F7D58]/30 text-[#2B5C3F] text-xs font-medium">
              <Clock className="w-3.5 h-3.5 text-[#3F7D58]" />
              <span>+coaster@ 2-Way Email · No App-Open Required</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.08] font-['Newsreader',Georgia,serif]">
              Your Evening Coaster, Right Inside Your Inbox.
            </h1>

            <p className="text-base text-[#6E6359] leading-relaxed">
              Twice a day (<strong className="text-[#1F1B18]">9:00 AM &amp; 7:00 PM</strong>),
              Sunny sends a calm summary of your Standard Drink Units with 1-tap logging links and
              a zero-login Live Coaster view. Just hit Reply to our dedicated{' '}
              <code className="font-mono text-[#1F1B18]">+coaster@</code> address with plain English
              or a drink photo.
            </p>

            {/* Sample 2-Window Preview */}
            <div className="space-y-3 pt-1">
              <div className="rounded-2xl border border-[#E8DFD1] bg-[#FFFDF9] p-4 space-y-1 shadow-xs">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#C26D2D]">
                  <span>9:00 AM · Morning Reflection</span>
                  <span>Zero-Login Coaster</span>
                </div>
                <p className="text-sm font-semibold text-[#1F1B18]">
                  Yesterday tallied 1.5u · 7-day rolling avg: 1.1u/day
                </p>
                <p className="text-xs text-[#6E6359] leading-relaxed">
                  Spot yesterday&apos;s entries, tap to mark an alcohol-free Clear Day, or reply{' '}
                  <em>&ldquo;Forgot a 5oz pinot last night&rdquo;</em> and Sunny adds it cleanly.
                </p>
              </div>

              <div className="rounded-2xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-4 space-y-1 shadow-xs">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#2B5C3F]">
                  <span>7:00 PM · Evening Check-In</span>
                  <span>1-Tap or Plain Reply</span>
                </div>
                <p className="text-sm font-semibold text-[#1F1B18]">
                  What&apos;s on tonight&apos;s coaster? +1.0u Beer · +1.0u Wine · Clear Day 0.0u
                </p>
                <p className="text-xs text-[#2B5C3F] leading-relaxed">
                  Tap one button inside the email or reply directly with a photo of your bottle or
                  bar tab—Sunny calculates Standard Drink Units and shares an optional zero-proof
                  idea.
                </p>
              </div>
            </div>
          </div>

          {/* Right Enrollment Form Card */}
          <div className="lg:col-span-6">
            <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-[0_10px_36px_rgba(31,27,24,0.06)] rounded-3xl overflow-hidden">
              <CardContent className="p-6 sm:p-8 space-y-6">
                {enrolledResult ? (
                  <div className="space-y-5">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EAF3ED] text-[#2B5C3F] text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-[#3F7D58]" />
                      {enrolledResult.deliveredNow
                        ? 'Welcome Email Sent — Check Your Inbox'
                        : 'Email Companion Activated'}
                    </div>

                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold tracking-tight font-['Newsreader',Georgia,serif]">
                        You&apos;re All Set
                      </h2>
                      <p className="text-sm text-[#6E6359] leading-relaxed">
                        Sunny just sent your{' '}
                        <strong className="text-[#1F1B18]">A New Journey Welcome Guide</strong> and
                        live coaster link:
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-4 space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2B5C3F]">
                        Live Coaster Status
                      </p>
                      <p className="text-base font-semibold text-[#1F1B18]">
                        {enrolledResult.headline}
                      </p>
                      <p className="text-xs text-[#4A4139] leading-relaxed">
                        {enrolledResult.body}
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                      <Button
                        type="button"
                        onClick={handleCopyShareLink}
                        className="flex-1 h-11 rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] text-xs font-semibold gap-2"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied Link
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy Invite Link
                          </>
                        )}
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        className="flex-1 h-11 rounded-xl border-[#E8DFD1] bg-[#FAF6F0] text-xs font-semibold"
                      >
                        <Link href="/">
                          Open Full App
                          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Link>
                      </Button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setEnrolledResult(null)}
                      className="text-xs font-medium text-[#6E6359] underline hover:text-[#1F1B18]"
                    >
                      Update email or schedule
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-1">
                      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight font-['Newsreader',Georgia,serif]">
                        Start Gentle Check-Ins
                      </h2>
                      <p className="text-xs text-[#6E6359]">
                        Delivers your &ldquo;A New Journey&rdquo; welcome guide + Live Coaster link
                        immediately.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="briefings-email"
                        className="text-xs font-semibold text-[#4A4139] flex items-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5 text-[#C26D2D]" />
                        Email Address
                      </Label>
                      <Input
                        id="briefings-email"
                        type="email"
                        required
                        placeholder="you@gmail.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-11 rounded-xl text-sm bg-[#FAF6F0] border-[#E8DFD1]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="briefings-name"
                        className="text-xs font-semibold text-[#4A4139]"
                      >
                        First Name (optional)
                      </Label>
                      <Input
                        id="briefings-name"
                        type="text"
                        placeholder="Marlo"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="h-11 rounded-xl text-sm bg-[#FAF6F0] border-[#E8DFD1]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="briefings-cadence"
                        className="text-xs font-semibold text-[#4A4139]"
                      >
                        Frequency
                      </Label>
                      <select
                        id="briefings-cadence"
                        value={cadence}
                        onChange={(e) => setCadence(e.target.value as OutreachCadence)}
                        className="w-full h-11 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] px-3 text-xs font-semibold text-[#1F1B18]"
                      >
                        <option value="2x">Morning &amp; Evening (2x/Day · Recommended)</option>
                        <option value="daily">Once Daily Check-In</option>
                        <option value="weekly">Weekly Rhythm Digest</option>
                      </select>
                    </div>

                    {/* Delivery Hours */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-[#4A4139]">
                          Delivery Hours
                        </Label>
                        <span className="text-[11px] font-mono text-[#6E6359]">{timezone}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <select
                          aria-label="Morning hour"
                          value={morningHour}
                          onChange={(e) => setMorningHour(Number(e.target.value))}
                          className="h-10 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] px-3 text-xs font-medium text-[#1F1B18]"
                        >
                          {[6, 7, 8, 9, 10, 11].map((h) => (
                            <option key={h} value={h}>
                              Morning · {h}:00 AM
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Evening hour"
                          disabled={cadence === 'morning_only'}
                          value={nightHour}
                          onChange={(e) => setNightHour(Number(e.target.value))}
                          className="h-10 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] px-3 text-xs font-medium text-[#1F1B18] disabled:opacity-40"
                        >
                          {[17, 18, 19, 20, 21, 22].map((h) => (
                            <option key={h} value={h}>
                              Evening · {h - 12}:00 PM
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {error && <p className="text-xs font-semibold text-[#B45309]">{error}</p>}

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full h-12 rounded-2xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] text-sm font-semibold shadow-md gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending Welcome Guide...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Send My Welcome Guide &amp; Start Check-Ins
                        </>
                      )}
                    </Button>

                    <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] font-medium text-[#6E6359] pt-1">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#3F7D58]" />
                        1-Tap Pause in Every Email
                      </span>
                      <span className="flex items-center gap-1">
                        <Leaf className="w-3.5 h-3.5 text-[#3F7D58]" />
                        Reply via +coaster@ with Text or Photos
                      </span>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
