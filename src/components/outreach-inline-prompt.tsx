'use client';

import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, Mail, X } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDoc, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { OutreachPreferences, UserPreferences } from '@/lib/health-service';
import {
  enrollPublicOutreachAction,
  updateMyOutreachSettingsAction,
} from '@/app/actions/outreach';

const DISMISS_STORAGE_KEY = 'coaster_outreachInlineDismissed';

export interface OutreachInlinePromptProps {
  variant: 'runway' | 'idle' | 'onboarding' | 'paywall';
  outreach?: OutreachPreferences;
  onEnrolled?: (result: { headline?: string; body?: string; deliveredNow?: boolean }) => void;
}

export function OutreachInlinePrompt({
  variant,
  outreach: outreachProp,
  onEnrolled,
}: OutreachInlinePromptProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const shouldSubscribePrefs = outreachProp === undefined;
  const prefsRef = useMemoFirebase(
    () =>
      shouldSubscribePrefs && user
        ? doc(db, 'users', user.uid, 'preferences', 'settings')
        : null,
    [shouldSubscribePrefs, db, user]
  );
  const { data: subscribedPrefs } = useDoc<UserPreferences>(prefsRef);
  const activeOutreach = outreachProp ?? subscribedPrefs?.outreach;

  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(variant === 'onboarding');
  const [emailInput, setEmailInput] = useState('');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [submitting, setSubmitting] = useState(false);
  const [justActivatedHeadline, setJustActivatedHeadline] = useState<string | null>(null);

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // Keep default America/Los_Angeles
    }
    if (variant === 'runway' || variant === 'idle') {
      try {
        if (localStorage.getItem(DISMISS_STORAGE_KEY) === '1') {
          setDismissed(true);
        }
      } catch {
        // Ignore storage restrictions
      }
    }
  }, [variant]);

  useEffect(() => {
    if (user?.email && !emailInput) {
      setEmailInput(user.email);
    } else if (activeOutreach?.email && !emailInput) {
      setEmailInput(activeOutreach.email);
    }
  }, [user?.email, activeOutreach?.email, emailInput]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore
    }
  };

  const activateOutreach = async () => {
    const targetEmail = (emailInput || user?.email || '').trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setExpanded(true);
      toast({
        variant: 'destructive',
        title: 'Email Required',
        description: 'Enter a valid email address for Morning & Evening check-ins.',
      });
      return;
    }

    setSubmitting(true);
    try {
      let res: {
        success: boolean;
        error?: string;
        headline?: string;
        body?: string;
        deliveredNow?: boolean;
      };

      if (user) {
        const idToken = await user.getIdToken();
        res = await updateMyOutreachSettingsAction(idToken, {
          enabled: true,
          channel: 'email',
          cadence: '2x',
          email: targetEmail,
          timezone,
          morningHour: 9,
          nightHour: 19,
          sendWelcomeNow: true,
        });
      } else {
        res = await enrollPublicOutreachAction({
          channel: 'email',
          email: targetEmail,
          cadence: '2x',
          timezone,
          morningHour: 9,
          nightHour: 19,
        });
      }

      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Could Not Enable Check-Ins',
          description: res.error || 'Please verify your email address and try again.',
        });
        return;
      }

      setJustActivatedHeadline(
        res.headline || 'Morning & Evening Check-Ins Active (+coaster@)'
      );
      toast({
        title: '2x/Day Email Companion Active',
        description: res.deliveredNow
          ? 'Sunny just sent your welcome guide and first check-in.'
          : 'Scheduled for 9:00 AM & 7:00 PM local time. Reply directly to log pours.',
      });
      onEnrolled?.({
        headline: res.headline,
        body: res.body,
        deliveredNow: res.deliveredNow,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Already enabled state
  if (activeOutreach?.enabled) {
    if ((variant === 'runway' || variant === 'idle') && !justActivatedHeadline) {
      return null;
    }

    const destination = activeOutreach.email || user?.email || 'your inbox';

    return (
      <div className="rounded-2xl border border-[#3F7D58]/35 bg-[#EAF3ED]/85 px-3.5 py-2.5 flex items-center justify-between gap-2 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-[#3F7D58] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#1F1B18] truncate">
              Sunny Email Companion Active (2x/day)
            </p>
            <p className="text-[11px] text-[#2B5C3F] truncate">
              {justActivatedHeadline ?? `Sending Morning & Evening check-ins to ${destination}`}
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#3F7D58] text-[#FFFDF9] shrink-0">
          Active
        </span>
      </div>
    );
  }

  if (dismissed && (variant === 'runway' || variant === 'idle')) {
    return null;
  }

  const hasKnownEmail = Boolean(user?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email));

  if (!expanded && (variant === 'runway' || variant === 'idle')) {
    return (
      <div
        className={`rounded-2xl border border-[#E8DFD1] bg-[#FFFDF9] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-left shadow-xs ${
          variant === 'idle' ? 'max-w-md w-full' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BellRing className="w-4 h-4 text-[#C26D2D] shrink-0" />
          <p className="text-xs text-[#1F1B18] leading-snug">
            <span className="font-semibold text-[#3F7D58] mr-1">+coaster@</span>
            Get Sunny&apos;s gentle Morning &amp; Evening email check-ins (2x/day) — reply right from
            your inbox.
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasKnownEmail ? (
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={activateOutreach}
              className="h-8 px-3 rounded-xl bg-[#3F7D58] hover:bg-[#316345] text-[#FFFDF9] text-xs font-medium"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Mail className="w-3 h-3 mr-1.5" />
                  Email Me 2x/Day
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setExpanded(true)}
              className="h-8 px-3 rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] text-xs font-medium"
            >
              Try Email Check-Ins
            </Button>
          )}
          <button
            type="button"
            aria-label="Dismiss email check-in prompt"
            onClick={handleDismiss}
            className="p-1 rounded-md text-[#6E6359] hover:text-[#1F1B18] hover:bg-[#FAF6F0] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-[#3F7D58]/30 bg-[#EAF3ED]/70 p-3.5 space-y-2.5 text-left ${
        variant === 'idle' ? 'max-w-md w-full shadow-xs' : 'w-full'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-md bg-[#3F7D58] text-[#FFFDF9] text-[10px] font-semibold uppercase tracking-wider">
              2-Way +coaster@
            </span>
            <span className="text-xs font-semibold text-[#1F1B18]">
              Morning &amp; Evening Email Companion (2x/day)
            </span>
          </div>
          <p className="text-[11px] text-[#4A4139] leading-snug">
            9:00 AM &amp; 7:00 PM check-ins from Sunny. Reply in plain English or attach a photo to
            tally drinks · 1-click pause anytime.
          </p>
        </div>

        {(variant === 'runway' || variant === 'idle') && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => setExpanded(false)}
            className="p-1 rounded-md text-[#6E6359] hover:text-[#1F1B18]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="you@domain.com"
          className="h-9 text-xs bg-[#FFFDF9] border-[#E8DFD1] flex-1"
        />

        <Button
          type="button"
          size="sm"
          disabled={submitting}
          onClick={activateOutreach}
          className="h-9 px-4 rounded-xl bg-[#3F7D58] hover:bg-[#316345] text-[#FFFDF9] text-xs font-semibold shrink-0"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Activating...
            </>
          ) : (
            'Enable 2x/Day Email'
          )}
        </Button>
      </div>
    </div>
  );
}
