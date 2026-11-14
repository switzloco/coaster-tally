'use client';

import React, { useEffect, useState } from 'react';
import { Bell, Check, Loader2, Mail, Send, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { OutreachCadence, OutreachPreferences } from '@/lib/health-service';
import {
  sendLiveBriefingNowAction,
  updateMyOutreachSettingsAction,
} from '@/app/actions/outreach';

interface OutreachSettingsCardProps {
  user: { email?: string | null; getIdToken: () => Promise<string> } | null;
  initialOutreach?: OutreachPreferences;
}

const CADENCE_OPTIONS: { id: OutreachCadence; label: string; summary: string }[] = [
  { id: '2x', label: '2x/Day (Morn & Eve)', summary: 'Morning reflection + Evening check-in' },
  { id: 'daily', label: 'Once Daily', summary: 'One check-in per day' },
  { id: 'weekly', label: 'Weekly Digest', summary: 'Sunday evening weekly rhythm' },
  { id: 'pause', label: 'Pause', summary: 'Temporarily paused' },
];

export function OutreachSettingsCard({ user, initialOutreach }: OutreachSettingsCardProps) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(Boolean(initialOutreach?.enabled));
  const [cadence, setCadence] = useState<OutreachCadence>(initialOutreach?.cadence ?? '2x');
  const [email, setEmail] = useState(initialOutreach?.email ?? user?.email ?? '');
  const [timezone, setTimezone] = useState(initialOutreach?.timezone ?? 'America/Los_Angeles');
  const [morningHour, setMorningHour] = useState(String(initialOutreach?.morningHour ?? 9));
  const [nightHour, setNightHour] = useState(String(initialOutreach?.nightHour ?? 19));

  const [isSaving, setIsSaving] = useState(false);
  const [isSendingNow, setIsSendingNow] = useState(false);
  const [livePreview, setLivePreview] = useState<{ headline: string; body: string } | null>(null);

  useEffect(() => {
    if (initialOutreach) {
      setEnabled(Boolean(initialOutreach.enabled));
      setCadence(initialOutreach.cadence ?? '2x');
      if (initialOutreach.email) setEmail(initialOutreach.email);
      if (initialOutreach.timezone) setTimezone(initialOutreach.timezone);
      if (initialOutreach.morningHour != null) setMorningHour(String(initialOutreach.morningHour));
      if (initialOutreach.nightHour != null) setNightHour(String(initialOutreach.nightHour));
    } else {
      try {
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detected) setTimezone(detected);
      } catch {
        // Fallback already set
      }
      if (user?.email && !email) setEmail(user.email);
    }
  }, [initialOutreach, user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (nextEnabled = enabled, nextCadence = cadence) => {
    if (!user) return;
    const effectiveEnabled = nextEnabled && nextCadence !== 'pause';
    setIsSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await updateMyOutreachSettingsAction(idToken, {
        enabled: effectiveEnabled,
        channel: 'email',
        cadence: effectiveEnabled ? nextCadence : 'pause',
        email,
        timezone,
        morningHour: Number(morningHour) || 9,
        nightHour: Number(nightHour) || 19,
      });

      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Could Not Update Email Companion',
          description: res.error || 'Please check your email address.',
        });
        return;
      }

      setEnabled(effectiveEnabled);
      if (!effectiveEnabled) setCadence('pause');
      toast({
        title: effectiveEnabled ? 'Email Companion Saved' : 'Email Check-Ins Paused',
        description: effectiveEnabled
          ? `Sunny will check in (${CADENCE_OPTIONS.find((o) => o.id === nextCadence)?.label ?? nextCadence}) in ${timezone}.`
          : 'Automated email check-ins paused cleanly.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendNow = async () => {
    if (!user) return;
    setIsSendingNow(true);
    try {
      const idToken = await user.getIdToken();
      const res = await sendLiveBriefingNowAction(idToken);
      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Check-In Error',
          description: res.error || 'Could not compose email check-in.',
        });
        return;
      }
      if (res.headline && res.body) {
        setLivePreview({ headline: res.headline, body: res.body });
      }
      toast({
        title: res.delivered ? 'Live Check-In Sent' : 'Live Check-In Composed',
        description: res.delivered
          ? 'Check your inbox — reply anytime via +coaster@.'
          : res.headline || 'Preview shown below.',
      });
    } finally {
      setIsSendingNow(false);
    }
  };

  return (
    <Card className="bg-[#FFFDF9] border-[#E8DFD1] shadow-sm rounded-2xl">
      <CardHeader className="p-5 sm:p-6 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold text-[#1F1B18] flex items-center gap-2.5">
            <Bell className="w-4 h-4 text-[#C26D2D]" />
            <span>2-Way +coaster@ Email Companion</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={
                enabled
                  ? 'bg-[#EAF3ED] text-[#2B5C3F] border border-[#3F7D58]/30 text-[10px] font-semibold uppercase'
                  : 'bg-[#F4EDE2] text-[#6E6359] text-[10px] font-semibold uppercase'
              }
            >
              {enabled ? 'Active' : 'Paused'}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked);
                const targetCadence = checked && cadence === 'pause' ? '2x' : cadence;
                if (checked && cadence === 'pause') setCadence('2x');
                handleSave(checked, targetCadence);
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5 sm:p-6 pt-1 space-y-4">
        <p className="text-xs sm:text-sm text-[#6E6359] leading-relaxed">
          Receive gentle Morning &amp; Evening check-ins from{' '}
          <strong className="text-[#1F1B18]">Sunny · Coaster</strong>. Simply reply to our
          dedicated <code className="font-mono text-[#1F1B18]">+coaster@</code> address with plain
          text (&ldquo;Glass of pinot noir&rdquo;, &ldquo;Clear day&rdquo;) or bottle photos—or tap
          any 1-click pour button in the email.
        </p>

        {/* Cadence Pills */}
        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6359]">
            Check-In Cadence
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CADENCE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setCadence(opt.id);
                  if (opt.id !== 'pause' && !enabled) setEnabled(true);
                }}
                className={`min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors ${
                  cadence === opt.id
                    ? 'border-[#C26D2D] bg-[#FEF3C7]/45 text-[#1F1B18]'
                    : 'border-[#E8DFD1] bg-[#FAF6F0] text-[#6E6359] hover:text-[#1F1B18]'
                }`}
              >
                <div className="text-xs font-semibold truncate">{opt.label}</div>
                <div className="text-[10px] opacity-80 truncate">{opt.summary}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6359] flex items-center gap-1.5">
              <Mail className="w-3 h-3 text-[#C26D2D]" />
              Delivery Email
            </Label>
            <Input
              type="email"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 text-xs bg-[#FAF6F0] border-[#E8DFD1]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6359]">
              Timezone
            </Label>
            <Input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 text-xs font-mono bg-[#FAF6F0] border-[#E8DFD1]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6359]">
              Morning Hour (local)
            </Label>
            <Input
              type="number"
              min={5}
              max={11}
              disabled={cadence === 'pause'}
              value={morningHour}
              onChange={(e) => setMorningHour(e.target.value)}
              className="h-9 text-xs bg-[#FAF6F0] border-[#E8DFD1]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6359]">
              Evening Hour (local)
            </Label>
            <Input
              type="number"
              min={16}
              max={22}
              disabled={cadence === 'pause' || cadence === 'morning_only'}
              value={nightHour}
              onChange={(e) => setNightHour(e.target.value)}
              className="h-9 text-xs bg-[#FAF6F0] border-[#E8DFD1]"
            />
          </div>
        </div>

        {livePreview && (
          <div className="rounded-xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-3.5 space-y-1">
            <div className="text-xs font-semibold text-[#1F1B18]">{livePreview.headline}</div>
            <div className="text-xs text-[#4A4139] leading-relaxed">{livePreview.body}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => handleSave(cadence !== 'pause', cadence === 'pause' ? 'pause' : cadence)}
            className="rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] font-semibold text-xs gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {enabled ? 'Save Check-In Schedule' : 'Enable Email Companion'}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSendingNow}
            onClick={handleSendNow}
            className="rounded-xl border-[#E8DFD1] bg-[#FAF6F0] hover:bg-[#F3ECE1] text-[#1F1B18] font-medium text-xs gap-1.5"
          >
            {isSendingNow ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 text-[#C26D2D]" />
            )}
            Send Test Check-In Now
          </Button>

          {enabled && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSaving}
              onClick={() => handleSave(false, 'pause')}
              className="rounded-xl text-xs font-medium text-[#6E6359] hover:text-[#1F1B18] gap-1.5 ml-auto"
            >
              <XCircle className="w-3.5 h-3.5" />
              Pause Emails
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
