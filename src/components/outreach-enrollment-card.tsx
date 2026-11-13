'use client';

import React, { useEffect, useState } from 'react';
import { Mail, Clock, CheckCircle2, Loader2, Sparkles, Leaf } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enrollPublicOutreachAction } from '@/app/actions/outreach';
import type { OutreachCadence } from '@/lib/health-service';

export function OutreachEnrollmentCard() {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [cadence, setCadence] = useState<OutreachCadence>('2x');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolledPreview, setEnrolledPreview] = useState<{
    headline: string;
    body: string;
    deliveredNow?: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Keep America/Los_Angeles fallback
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await enrollPublicOutreachAction({
        channel: 'email',
        email,
        cadence,
        timezone,
        morningHour: 9,
        nightHour: 19,
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
      });

      if (!res.success) {
        setError(res.error || 'Could not activate Email Companion.');
        return;
      }

      setEnrolledPreview({
        headline: res.headline || 'Sunny Email Companion Activated',
        body:
          res.body ||
          'Your welcome guide and check-ins are on the way. Reply anytime via our +coaster@ inbox to log pours or clear evenings.',
        deliveredNow: res.deliveredNow,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="email-companion" className="py-12 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-[0_8px_32px_rgba(31,27,24,0.06)] overflow-hidden rounded-3xl">
          <CardContent className="p-6 sm:p-10 space-y-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EAF3ED] border border-[#3F7D58]/30 text-[#2B5C3F] text-xs font-medium">
                <Clock className="w-3.5 h-3.5 text-[#3F7D58]" />
                <span>2-Way +coaster@ Email Companion · Free · Pause Anytime</span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1F1B18] font-['Newsreader',Georgia,serif]">
                Prefer a Gentle Inbox Check-In Over Opening Another App?
              </h3>

              <p className="text-sm sm:text-base text-[#6E6359] max-w-2xl leading-relaxed">
                Sunny can drop by at <strong className="text-[#1F1B18]">9:00 AM &amp; 7:00 PM</strong>{' '}
                with your running tally and 1-tap buttons. Just{' '}
                <strong className="text-[#1F1B18]">reply to the +coaster@ email</strong> in plain
                English (&ldquo;Two hazy IPAs at trivia&rdquo; or &ldquo;Clear day&rdquo;) or attach a
                can label photo to log automatically.
              </p>
            </div>

            {enrolledPreview ? (
              <div className="rounded-2xl border border-[#3F7D58]/35 bg-[#EAF3ED]/75 p-5 sm:p-6 space-y-3">
                <div className="flex items-center gap-2 text-[#2B5C3F] text-xs font-semibold uppercase tracking-wider">
                  <CheckCircle2 className="w-4 h-4 text-[#3F7D58]" />
                  {enrolledPreview.deliveredNow
                    ? 'Active — Welcome & Check-In Sent to Your Inbox'
                    : 'Active — Scheduled for Your Local Timezone'}
                </div>
                <div className="text-lg font-semibold text-[#1F1B18]">
                  {enrolledPreview.headline}
                </div>
                <p className="text-sm text-[#4A4139] leading-relaxed">{enrolledPreview.body}</p>
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs font-medium border-[#E8DFD1] bg-[#FFFDF9] hover:bg-[#FAF6F0]"
                    onClick={() => setEnrolledPreview(null)}
                  >
                    Update Delivery Preferences
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label
                      htmlFor="outreach-email"
                      className="text-xs font-semibold text-[#4A4139]"
                    >
                      Email Address
                    </Label>
                    <Input
                      id="outreach-email"
                      type="email"
                      required
                      placeholder="you@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 rounded-xl bg-[#FAF6F0] border-[#E8DFD1] text-[#1F1B18]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="outreach-firstname"
                      className="text-xs font-semibold text-[#4A4139]"
                    >
                      First Name (optional)
                    </Label>
                    <Input
                      id="outreach-firstname"
                      type="text"
                      placeholder="Marlo"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="h-11 rounded-xl bg-[#FAF6F0] border-[#E8DFD1] text-[#1F1B18]"
                    />
                  </div>
                </div>

                {/* Cadence Selection */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {(
                    [
                      { id: '2x', label: 'Morning & Evening (2x/day)' },
                      { id: 'daily', label: 'Once Daily' },
                      { id: 'weekly', label: 'Weekly Digest' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCadence(opt.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                        cadence === opt.id
                          ? 'bg-[#C26D2D] text-[#FFFDF9] border-[#C26D2D] shadow-xs'
                          : 'bg-[#FAF6F0] text-[#4A4139] border-[#E8DFD1] hover:border-[#C26D2D]/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <span className="text-[11px] font-mono text-[#6E6359] sm:ml-auto">
                    {timezone}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-2 text-xs text-[#6E6359]">
                    <Leaf className="w-4 h-4 text-[#3F7D58] shrink-0" />
                    <span>
                      Dedicated <code className="font-mono text-[#1F1B18]">+coaster@</code> reply
                      box · 1-click pause in every email
                    </span>
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-11 px-6 rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] font-semibold text-xs sm:text-sm gap-2 shrink-0 shadow-md shadow-[#C26D2D]/15"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4" />
                    )}
                    <span>Start Email Check-Ins</span>
                    <Sparkles className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {error && <p className="text-xs font-semibold text-[#B45309]">{error}</p>}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
