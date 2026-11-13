'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { healthService, type OutreachPreferences } from '@/lib/health-service';
import {
  fetchAllLedger,
  ledgerToCSV,
  ledgerToJSON,
  downloadTextFile,
} from '@/lib/ledger-export';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import { ExecutionReceiptBadge } from '@/components/execution-receipt-badge';
import { OutreachSettingsCard } from '@/components/outreach-settings-card';
import { MySharesSection } from '@/components/my-shares-section';
import { deleteMyAccountAction } from '@/app/actions/delete-account';
import { submitContactForm } from '@/app/actions/contact';
import { useToast } from '@/hooks/use-toast';
import { getAuth, signOut } from 'firebase/auth';
import {
  Bell,
  Check,
  Copy,
  Cpu,
  Download,
  Globe,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface CoasterUserDoc {
  timezone?: string;
  quietEveningEnabled?: boolean;
  quietEveningHour?: string;
  preferredZeroProofFlavors?: string[];
}

const ZERO_PROOF_TASTE_OPTIONS = [
  { id: 'citrus', label: 'Bright Citrus', hint: 'Grapefruit, yuzu, lime soda' },
  { id: 'bitter', label: 'Bitter & Aperitif', hint: 'Gentian, amaro, tonic' },
  { id: 'hoppy_na', label: 'Hoppy NA', hint: 'Dry-hopped sparkling, 0.0% pils' },
  { id: 'botanical', label: 'Botanical & Herbal', hint: 'Juniper, rosemary, cucumber' },
  { id: 'spicy_ginger', label: 'Ginger & Spice', hint: 'Fiery ginger beer, chili lime' },
  { id: 'dry_crisp', label: 'Dry & Mineral', hint: 'De-alcoholized bubbles, club soda' },
] as const;

const EVENING_HOURS = [
  { value: '17:00', label: '5:00 PM' },
  { value: '18:00', label: '6:00 PM' },
  { value: '19:00', label: '7:00 PM' },
  { value: '20:00', label: '8:00 PM' },
  { value: '21:00', label: '9:00 PM' },
  { value: '22:00', label: '10:00 PM' },
];

const FALLBACK_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

export function PreferencesView() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const {
    nanoStatus,
    isWarmingNano,
    nanoDownloadPct,
    warmNanoError,
    warmNano,
    isOnline,
    secPrivacyLock,
    setSecPrivacyLock,
    remoteConfig,
    appCheck,
    recentReceipts,
  } = useHybridAi();

  const userDocRef = useMemoFirebase(() => {
    if (!user || !db) return null;
    return doc(db, 'users', user.uid);
  }, [user, db]);

  const { data: userDoc } = useDoc<CoasterUserDoc>(userDocRef);

  const [timezone, setTimezone] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    } catch {
      return 'America/New_York';
    }
  });
  const [quietEveningEnabled, setQuietEveningEnabled] = useState(false);
  const [quietEveningHour, setQuietEveningHour] = useState('20:00');
  const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);
  const [loadedOutreach, setLoadedOutreach] = useState<OutreachPreferences | undefined>(undefined);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [exportingFormat, setExportingFormat] = useState<'csv' | 'json' | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);

  useEffect(() => {
    if (userDoc?.timezone) setTimezone(userDoc.timezone);
    if (typeof userDoc?.quietEveningEnabled === 'boolean') {
      setQuietEveningEnabled(userDoc.quietEveningEnabled);
    }
    if (userDoc?.quietEveningHour) setQuietEveningHour(userDoc.quietEveningHour);
    if (Array.isArray(userDoc?.preferredZeroProofFlavors)) {
      setSelectedFlavors(userDoc.preferredZeroProofFlavors);
    }
  }, [userDoc]);

  useEffect(() => {
    if (!user || !db) return;
    let active = true;
    healthService
      .getUserPreferences(db, user.uid)
      .then((prefs) => {
        if (!active || !prefs) return;
        if (prefs.outreach) {
          setLoadedOutreach(prefs.outreach);
          if (!userDoc?.timezone && prefs.outreach.timezone) {
            setTimezone(prefs.outreach.timezone);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user, db, userDoc?.timezone]);

  const timezoneList = useMemo(() => {
    try {
      const supported = (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.('timeZone');
      if (supported && supported.length > 0) return supported;
    } catch {
      // use fallback
    }
    return FALLBACK_TIMEZONES;
  }, []);

  const toggleFlavor = (flavorId: string) => {
    setSelectedFlavors((prev) =>
      prev.includes(flavorId) ? prev.filter((id) => id !== flavorId) : [...prev, flavorId]
    );
  };

  const handleSavePreferences = async () => {
    if (!user || !db) return;
    setSavingPrefs(true);
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          timezone,
          quietEveningEnabled,
          quietEveningHour,
          preferredZeroProofFlavors: selectedFlavors,
        },
        { merge: true }
      );
      toast({
        title: 'Coaster preferences saved',
        description: 'Timezone, evening check-in, and swap tastes updated.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: 'Could not update preferences right now.',
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (!user || !db) return;
    setExportingFormat(format);
    try {
      const snapshot = await fetchAllLedger(db, user.uid);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        downloadTextFile(`coaster-ledger-${stamp}.csv`, ledgerToCSV(snapshot), 'text/csv');
      } else {
        downloadTextFile(
          `coaster-ledger-${stamp}.json`,
          ledgerToJSON(snapshot),
          'application/json'
        );
      }
      toast({ title: `Exported ${format.toUpperCase()}` });
    } catch {
      toast({ variant: 'destructive', title: 'Export failed' });
    } finally {
      setExportingFormat(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setIsDeleting(true);
    try {
      const idToken = await user.getIdToken(true);
      const result = await deleteMyAccountAction(idToken);
      if (!result.success) {
        throw new Error(result.error || 'Account deletion failed.');
      }
      toast({
        title: 'Account permanently deleted',
        description: 'All Coaster logs and auth records have been cleared.',
      });
      await signOut(getAuth()).catch(() => {});
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Could not delete account',
        description: err instanceof Error ? err.message : 'Please sign in again and retry.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackMessage.trim()) return;
    setSendingFeedback(true);
    try {
      const res = await submitContactForm({
        name: feedbackName || user?.displayName || 'Coaster User',
        email: feedbackEmail || user?.email || '',
        message: feedbackMessage,
        uid: user?.uid,
        context: 'preferences_view',
      });
      if (!res.success) throw new Error(res.error || 'Could not send note.');
      setFeedbackMessage('');
      toast({
        title: 'Note sent',
        description: 'Thanks for sharing feedback with the Coaster team.',
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Could not send note',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      });
    } finally {
      setSendingFeedback(false);
    }
  };

  const copyUid = () => {
    if (!user?.uid) return;
    navigator.clipboard.writeText(user.uid);
    toast({ title: 'User ID copied' });
  };

  return (
    <div className="space-y-6">
      {/* 1. Coaster Rhythm & Zero-Proof Swap Preferences */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg font-bold text-[#1F1B18]">
                Coaster Preferences &amp; Swap Tastes
              </CardTitle>
              <CardDescription className="text-xs text-[#6E6359]">
                Tune your local clock, optional evening check-in hour, and zero-proof flavors.
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={savingPrefs}
              onClick={handleSavePreferences}
              className="rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] text-xs font-bold px-4"
            >
              {savingPrefs ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Check className="w-3.5 h-3.5 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-5 space-y-6">
          {/* Timezone */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[#6E6359] flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#C26D2D]" />
              Local Timezone
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex-1 h-10 px-3 rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] text-sm font-medium text-[#1F1B18]"
              >
                {timezoneList.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  try {
                    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    if (detected) setTimezone(detected);
                  } catch {
                    // ignore
                  }
                }}
                className="h-10 border-[#E8DFD1] bg-[#FAF6F0] text-xs font-semibold text-[#1F1B18]"
              >
                Use device timezone
              </Button>
            </div>
          </div>

          {/* Quiet Evening Hour Reminder */}
          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#C26D2D]" />
                <span className="text-sm font-bold text-[#1F1B18]">
                  Quiet Evening Coaster Nudge
                </span>
              </div>
              <p className="text-xs text-[#6E6359]">
                Optional gentle evening check-in hour to wrap up today&apos;s pours or tap Clear Day.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {quietEveningEnabled && (
                <select
                  value={quietEveningHour}
                  onChange={(e) => setQuietEveningHour(e.target.value)}
                  aria-label="Preferred quiet evening reminder hour"
                  className="h-9 px-2.5 rounded-xl bg-[#FFFDF9] border border-[#E8DFD1] text-xs font-bold text-[#1F1B18]"
                >
                  {EVENING_HOURS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              <Switch
                checked={quietEveningEnabled}
                onCheckedChange={setQuietEveningEnabled}
                aria-label="Toggle quiet evening coaster reminder"
              />
            </div>
          </div>

          {/* Zero-Proof Swap Taste Profile */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#3F7D58]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#6E6359]">
                Zero-Proof Swap Taste Preferences
              </span>
            </div>
            <p className="text-xs text-[#6E6359]">
              Pick flavor profiles Sunny should prioritize when suggesting alcohol-free pairings.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ZERO_PROOF_TASTE_OPTIONS.map((opt) => {
                const active = selectedFlavors.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleFlavor(opt.id)}
                    className={`rounded-2xl border px-3.5 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-[#3F7D58]/12 border-[#3F7D58] text-[#1F1B18]'
                        : 'bg-[#FAF6F0] border-[#E8DFD1] hover:border-[#C26D2D]/50 text-[#1F1B18]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{opt.label}</span>
                      {active && <Check className="w-3.5 h-3.5 text-[#3F7D58]" />}
                    </div>
                    <p className="text-[11px] text-[#6E6359] mt-0.5">{opt.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Email Companion Link */}
      <OutreachSettingsCard user={user} initialOutreach={loadedOutreach} />

      {/* 3. Hybrid AI & Privacy Vault */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-[#1F1B18] flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#C26D2D]" />
                Hybrid AI &amp; Privacy Vault
              </CardTitle>
              <CardDescription className="text-xs text-[#6E6359]">
                Run pour notes on-device with Gemini Nano when supported, or lock inference locally.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${
                  isOnline
                    ? 'bg-[#3F7D58]/10 border-[#3F7D58]/25 text-[#3F7D58]'
                    : 'bg-[#C26D2D]/10 border-[#C26D2D]/25 text-[#C26D2D]'
                }`}
              >
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {isOnline ? 'Online' : 'Offline'}
              </span>
              {appCheck?.status && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FAF6F0] border border-[#E8DFD1] text-[#6E6359]">
                  <ShieldCheck className="w-3 h-3 text-[#3F7D58]" />
                  Verified
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#3F7D58]" />
                <span className="text-sm font-bold text-[#1F1B18]">
                  Strict Privacy Vault (ONLY_ON_DEVICE)
                </span>
              </div>
              <p className="text-xs text-[#6E6359]">
                When locked, Sunny never sends drink prompts or notes to cloud endpoints.
              </p>
            </div>
            <Switch
              checked={secPrivacyLock}
              onCheckedChange={setSecPrivacyLock}
              aria-label="Toggle Strict Privacy Vault"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-[#FAF6F0] border border-[#E8DFD1] rounded-2xl p-3.5">
            <div className="space-y-0.5">
              <p className="font-bold text-[#1F1B18]">
                On-Device Engine: <span className="text-[#C26D2D]">{nanoStatus}</span>
              </p>
              <p className="text-[#6E6359]">
                Default routing: {remoteConfig?.hybridDefaultMode || 'PREFER_ON_DEVICE'}
                {nanoDownloadPct !== null && nanoDownloadPct > 0 && nanoDownloadPct < 100
                  ? ` • Downloading ${nanoDownloadPct}%`
                  : ''}
              </p>
              {warmNanoError && (
                <p className="text-[11px] text-[#C26D2D]">{warmNanoError}</p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isWarmingNano}
              onClick={() => warmNano()}
              className="border-[#E8DFD1] bg-[#FFFDF9] text-xs font-bold text-[#1F1B18]"
            >
              {isWarmingNano && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Warm Local Model
            </Button>
          </div>

          {recentReceipts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {recentReceipts.slice(-4).map((r, i) => (
                <ExecutionReceiptBadge
                  key={r.id || i}
                  inferenceSource={r.inferenceSource}
                  latencyMs={r.latencyMs}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Shared Coaster Links */}
      <MySharesSection />

      {/* 5. Data Export & Account Deletion */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
          <CardTitle className="text-base font-bold text-[#1F1B18]">
            Your Data &amp; Account
          </CardTitle>
          <CardDescription className="text-xs text-[#6E6359]">
            Download your full Coaster ledger anytime or permanently erase your account.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={exportingFormat !== null}
                onClick={() => handleExport('csv')}
                className="border-[#E8DFD1] bg-[#FAF6F0] text-xs font-semibold text-[#1F1B18]"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export CSV
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={exportingFormat !== null}
                onClick={() => handleExport('json')}
                className="border-[#E8DFD1] bg-[#FAF6F0] text-xs font-semibold text-[#1F1B18]"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export JSON
              </Button>
            </div>

            {user?.uid && (
              <button
                type="button"
                onClick={copyUid}
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#6E6359] hover:text-[#1F1B18]"
              >
                <span>ID: {user.uid.slice(0, 10)}…</span>
                <Copy className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="pt-3 border-t border-[#E8DFD1]/70">
            {!showDeletePanel ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowDeletePanel(true)}
                className="text-xs font-semibold text-[#6E6359] hover:text-[#C26D2D] px-0"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Permanently delete my account &amp; logs
              </Button>
            ) : (
              <div className="rounded-2xl bg-[#FAF6F0] border border-[#C26D2D]/35 p-4 space-y-3">
                <p className="text-xs font-bold text-[#1F1B18]">
                  This erases every pour log, preference, share link, and login record permanently.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE to confirm"
                    className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowDeletePanel(false);
                        setDeleteConfirmText('');
                      }}
                      className="h-9 border-[#E8DFD1]"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        isDeleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'
                      }
                      onClick={handleDeleteAccount}
                      className="h-9 bg-[#C26D2D] hover:bg-[#AD5D23] text-white font-bold"
                    >
                      {isDeleting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      Delete Forever
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 6. Direct Feedback */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
          <CardTitle className="text-base font-bold text-[#1F1B18] flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#C26D2D]" />
            Send a Note to Coaster
          </CardTitle>
          <CardDescription className="text-xs text-[#6E6359]">
            Spot a rough edge or want a new swap style added? Let us know directly.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleFeedbackSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                value={feedbackName}
                onChange={(e) => setFeedbackName(e.target.value)}
                placeholder="Your name (optional)"
                className="h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
              />
              <Input
                type="email"
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                placeholder="Reply email (optional)"
                className="h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
              />
            </div>
            <Textarea
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              placeholder="Write your note here..."
              rows={3}
              className="bg-[#FAF6F0] border-[#E8DFD1] text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={sendingFeedback || !feedbackMessage.trim()}
              className="rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] px-4 text-xs font-bold"
            >
              {sendingFeedback ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1.5" />
              )}
              Send Note
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
