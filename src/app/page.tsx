'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Sunrise,
  ShieldCheck,
  MessageCircle,
  GlassWater,
  TrendingUp,
  LogOut,
  Cloud,
  Loader2,
  User as UserIcon,
  RefreshCw,
  Settings,
  Sparkles,
  Wifi,
  WifiOff,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase, useFirebaseApp } from '@/firebase';
import {
  signInAnonymously,
  linkWithPopup,
  linkWithRedirect,
  GoogleAuthProvider,
  signOut,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import {
  shouldUseRedirectSignIn,
  isPopupUnavailableError,
  isUserCancelledError,
} from '@/lib/auth-environment';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { healthService, HealthData, UserPreferences } from '@/lib/health-service';
import { LocalAiTelemetryBar } from '@/components/local-ai-telemetry-bar';
import { QuarterlyEarningsModal } from '@/components/quarterly-earnings-modal';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import {
  ExecutionReceiptBadge,
  SecComplianceAlertPanel,
} from '@/components/execution-receipt-badge';
import {
  runLocalAuditWithFallback,
  SecPrivacyLockBlockedError,
  type HybridExecutionReceipt,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';

const ChatInterface = dynamic(
  () => import('@/components/chat-interface').then((m) => ({ default: m.ChatInterface })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C26D2D] animate-spin" />
      </div>
    ),
  }
);
const DashboardCards = dynamic(
  () => import('@/components/dashboard-cards').then((m) => ({ default: m.DashboardCards })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C26D2D] animate-spin" />
      </div>
    ),
  }
);
const HistoryView = dynamic(
  () => import('@/components/history-view').then((m) => ({ default: m.HistoryView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C26D2D] animate-spin" />
      </div>
    ),
  }
);
const PreferencesView = dynamic(
  () => import('@/components/preferences-view').then((m) => ({ default: m.PreferencesView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C26D2D] animate-spin" />
      </div>
    ),
  }
);
const AboutView = dynamic(
  () => import('@/components/about-view').then((m) => ({ default: m.AboutView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C26D2D] animate-spin" />
      </div>
    ),
  }
);
const OnboardingTutorial = dynamic(
  () => import('@/components/onboarding-tutorial').then((m) => ({ default: m.OnboardingTutorial })),
  { ssr: false }
);
const PublicLanding = dynamic(
  () => import('@/components/public-landing').then((m) => ({ default: m.PublicLanding })),
  { ssr: false }
);

type CoasterTab = 'chat' | 'daily' | 'trends' | 'settings';

export default function Home() {
  const { user, isUserLoading } = useUser();
  const firebaseApp = useFirebaseApp();
  const auth = useAuth();
  const db = useFirestore();
  const { toast } = useToast();
  const {
    isOnline,
    secPrivacyLock,
    setSecPrivacyLock,
    warmNano,
    recordReceipt,
    setEarningsModalOpen,
  } = useHybridAi();

  const [activeTab, setActiveTab] = useState<CoasterTab>('chat');
  const [isAuditing, setIsAuditing] = useState(false);
  const [vaultAuditSummary, setVaultAuditSummary] = useState<{
    headline?: string;
    summary: string;
    receipt?: HybridExecutionReceipt;
  } | null>(null);
  const [vaultAlert, setVaultAlert] = useState<SecComplianceAlert | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Pull-to-refresh state (Today tab)
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const dailyScrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const isPullCandidate = useRef(false);
  const pullDistanceRef = useRef(0);
  const isPullRefreshingRef = useRef(false);
  const PULL_COMMIT_PX = 16;
  const PULL_THRESHOLD = 110;

  const userDocRef = useMemoFirebase(() => (user ? doc(db, 'users', user.uid) : null), [db, user]);
  const { data: healthData, isLoading: isHealthLoading } = useDoc<HealthData>(userDocRef);

  const prefsDocRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [db, user]
  );
  useDoc<UserPreferences>(prefsDocRef);

  useEffect(() => {
    if (user && db) {
      healthService.getHealthSummary(db, user.uid);
      healthService.getUserPreferences(db, user.uid);
    }
  }, [user, db]);

  // Persist active tab across reloads
  useEffect(() => {
    const saved = sessionStorage.getItem('coaster_activeTab') as CoasterTab | null;
    if (saved && ['chat', 'daily', 'trends', 'settings'].includes(saved)) {
      setActiveTab(saved);
    }

    const tutorialSeen = localStorage.getItem('coaster_tutorialSeen');
    if (!tutorialSeen && user) {
      setShowTutorial(true);
    }
  }, [user]);

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    localStorage.setItem('coaster_tutorialSeen', 'true');
  };

  const handleTabChange = useCallback((tab: string) => {
    const next = (['chat', 'daily', 'trends', 'settings'].includes(tab)
      ? tab
      : 'chat') as CoasterTab;
    setActiveTab(next);
    sessionStorage.setItem('coaster_activeTab', next);
  }, []);

  useEffect(() => {
    isPullRefreshingRef.current = isPullRefreshing;
  }, [isPullRefreshing]);

  const doCoasterRefresh = useCallback(async () => {
    if (!user) return;
    setIsPullRefreshing(true);
    isPullRefreshingRef.current = true;
    try {
      await healthService.getHealthSummary(db, user.uid);
      toast({
        title: isOnline ? 'Coaster Synced' : 'Offline Cache Refreshed',
        description: isOnline
          ? 'Your Today tally and recent pours are up to date.'
          : 'Loaded from local IndexedDB coaster persistence.',
      });
    } finally {
      setIsPullRefreshing(false);
      isPullRefreshingRef.current = false;
    }
  }, [user, db, isOnline, toast]);

  const doCoasterRefreshRef = useRef(doCoasterRefresh);
  useEffect(() => {
    doCoasterRefreshRef.current = doCoasterRefresh;
  }, [doCoasterRefresh]);

  // Custom pull-to-refresh on Today tab
  useEffect(() => {
    const el = dailyScrollRef.current;
    if (!el || activeTab !== 'daily') return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop === 0 && !isPullRefreshingRef.current) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = false;
        isPullCandidate.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isPullRefreshingRef.current) return;
      if (!isPullCandidate.current && !isPulling.current) return;

      const delta = e.touches[0].clientY - touchStartY.current;

      if (!isPulling.current) {
        if (delta < 0) {
          isPullCandidate.current = false;
          return;
        }
        if (delta < PULL_COMMIT_PX) return;
        if (el.scrollTop !== 0) {
          isPullCandidate.current = false;
          return;
        }
        isPulling.current = true;
        isPullCandidate.current = false;
      }

      const effective = delta - PULL_COMMIT_PX;
      if (effective > 0 && el.scrollTop === 0) {
        e.preventDefault();
        const clamped = Math.min(effective, PULL_THRESHOLD * 1.4);
        pullDistanceRef.current = clamped;
        setPullDistance(clamped);
      } else if (effective <= 0) {
        isPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      isPullCandidate.current = false;
      if (!isPulling.current) return;
      isPulling.current = false;
      const dist = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (dist >= PULL_THRESHOLD) {
        doCoasterRefreshRef.current();
      }
    };

    const onTouchCancel = () => {
      isPullCandidate.current = false;
      isPulling.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [activeTab]);

  // Resolve redirect-based Google sign-in safely (required for WebView / standalone PWA)
  useEffect(() => {
    let cancelled = false;
    getRedirectResult(auth)
      .then((result) => {
        if (cancelled || !result) return;
        toast({
          title: 'Coaster Connected',
          description: 'Signed in with Google. Your pours and trends stay synced.',
        });
      })
      .catch((e: any) => {
        if (cancelled || isUserCancelledError(e)) return;
        toast({ variant: 'destructive', title: 'Sign-In Issue', description: e.message });
      })
      .finally(() => {
        if (!cancelled) setIsLoggingIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth, toast]);

  const handleAnonymousLogin = async () => {
    setIsLoggingIn(true);
    try {
      await signInAnonymously(auth);
      toast({ title: 'Welcome to Coaster', description: 'Your private table is ready.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not open Coaster', description: e.message });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();

    if (shouldUseRedirectSignIn()) {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Sign-In Issue', description: e.message });
        setIsLoggingIn(false);
        return;
      }
    }

    try {
      await signInWithPopup(auth, provider);
      toast({
        title: 'Coaster Connected',
        description: 'Signed in with Google. Synced across devices.',
      });
      setIsLoggingIn(false);
    } catch (e: any) {
      if (isUserCancelledError(e)) {
        setIsLoggingIn(false);
        return;
      }
      if (isPopupUnavailableError(e)) {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError: any) {
          toast({
            variant: 'destructive',
            title: 'Sign-In Issue',
            description: redirectError.message,
          });
          setIsLoggingIn(false);
          return;
        }
      }
      toast({ variant: 'destructive', title: 'Sign-In Issue', description: e.message });
      setIsLoggingIn(false);
    }
  };

  const handleUpgradeAccount = async () => {
    if (!user) return;
    const provider = new GoogleAuthProvider();

    if (shouldUseRedirectSignIn()) {
      try {
        await linkWithRedirect(user, provider);
        return;
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Sync Issue', description: error.message });
        return;
      }
    }

    try {
      await linkWithPopup(user, provider);
      toast({
        title: 'Coaster Saved to Google',
        description: 'Your guest history is now linked to your Google account.',
      });
    } catch (error: any) {
      if (isUserCancelledError(error)) return;
      if (isPopupUnavailableError(error)) {
        try {
          await linkWithRedirect(user, provider);
          return;
        } catch (redirectError: any) {
          toast({ variant: 'destructive', title: 'Sync Issue', description: redirectError.message });
          return;
        }
      }
      toast({ variant: 'destructive', title: 'Sync Issue', description: error.message });
    }
  };

  const handlePrivacyVaultAudit = async () => {
    if (!user) return;
    setIsAuditing(true);
    setVaultAlert(null);
    handleTabChange('settings');

    try {
      const recentLogs = await healthService
        .queryFoodLog(db, user.uid, undefined, 90)
        .catch(() => []);

      const res = (await runLocalAuditWithFallback({
        firebaseApp,
        logs: recentLogs,
        strictNanoOnly: secPrivacyLock,
      })) as {
        headline?: string;
        summary?: string;
        replyText?: string;
        receipt?: HybridExecutionReceipt;
      };

      const summary =
        res.summary ||
        res.replyText ||
        'On-device 30-day drink & clear-day review finished inside your browser.';
      setVaultAuditSummary({
        headline: res.headline || 'Privacy Vault 30-Day Review (On-Device)',
        summary,
        receipt: res.receipt,
      });
      if (res.receipt) recordReceipt(res.receipt);
      toast({
        title: 'Privacy Vault Review Complete',
        description: 'Executed privately on-device with zero cloud transmission.',
      });
    } catch (err) {
      if (err instanceof SecPrivacyLockBlockedError) {
        setVaultAlert(err.alert);
      } else {
        toast({
          variant: 'destructive',
          title: 'On-Device Review Unavailable',
          description:
            err instanceof Error
              ? err.message
              : 'Warm Local Nano Engine first to run strict on-device audits.',
        });
      }
    } finally {
      setIsAuditing(false);
    }
  };

  if (!user && !isUserLoading) {
    return (
      <PublicLanding
        onLogin={handleGoogleLogin}
        onAnonymousLogin={handleAnonymousLogin}
        isLoggingIn={isLoggingIn}
      />
    );
  }

  if (isUserLoading || (user && !healthData && isHealthLoading)) {
    return (
      <div className="h-screen bg-[#FAF6F0] flex flex-col items-center justify-center space-y-5">
        <Loader2 className="w-10 h-10 text-[#C26D2D] animate-spin" />
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-[#1F1B18] font-['Newsreader',Georgia,serif]">
            Setting out your Coaster...
          </p>
          <p className="text-xs text-[#6E6359]">Loading local ledger &amp; recent trends</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] md:h-auto md:min-h-0 md:flex-1 w-full md:max-w-6xl mx-auto bg-[#FAF6F0] md:shadow-xl md:border-x border-[#E8DFD1] overflow-hidden">
      <OnboardingTutorial isOpen={showTutorial} onComplete={handleTutorialComplete} />
      <QuarterlyEarningsModal />

      {/* Top Workspace Header */}
      <header className="px-3.5 py-2.5 md:px-6 md:py-3 flex items-center justify-between bg-[#FFFDF9]/90 backdrop-blur-md border-b border-[#E8DFD1] z-10 shrink-0">
        <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[#C26D2D] text-[#FFFDF9] flex items-center justify-center shadow-xs shrink-0 ring-2 ring-[#C26D2D]/15">
            <Sunrise className="w-4 h-4 md:w-5 md:h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-semibold tracking-tight leading-none text-[#1F1B18] font-['Newsreader',Georgia,serif]">
              Coaster
            </h1>
            <p className="text-[10px] md:text-[11px] font-medium text-[#6E6359] mt-0.5 truncate">
              Mindful Drink Tally · Sunny
              <span className="hidden sm:inline opacity-60 font-mono">
                {' '}
                · {process.env.NEXT_PUBLIC_BUILD_ID ?? 'live'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 md:gap-3.5 shrink-0">
          {/* Firestore Offline Persistence Status Pill */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold border ${
              isOnline
                ? 'border-[#3F7D58]/30 bg-[#EAF3ED] text-[#2B5C3F]'
                : 'border-[#D97706]/40 bg-[#FEF3C7] text-[#9A4E16]'
            }`}
            title={
              isOnline
                ? 'Firestore persistence active and synced'
                : 'Working offline with Firestore IndexedDB local cache'
            }
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span className="hidden sm:inline">
              {isOnline ? 'Synced' : 'Offline Cache'}
            </span>
          </span>

          {!user?.isAnonymous && (
            <div className="hidden md:flex flex-col items-end mr-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3F7D58]">
                Synced Account
              </p>
              <p className="text-xs font-medium text-[#1F1B18] truncate max-w-[160px]">
                {user?.displayName || user?.email}
              </p>
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full hover:bg-[#FAF6F0] relative overflow-hidden h-9 w-9 md:h-10 md:w-10 border border-[#E8DFD1] p-0"
              >
                {isAuditing ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#C26D2D]" />
                ) : (
                  <Avatar className="h-full w-full">
                    <AvatarImage src={user?.photoURL || undefined} />
                    <AvatarFallback className="bg-[#FAF6F0] text-[#C26D2D] font-semibold text-xs">
                      {user?.displayName?.charAt(0) || user?.email?.charAt(0) || (
                        <UserIcon className="w-4 h-4" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 bg-[#FFFDF9] border-[#E8DFD1]">
              <DropdownMenuLabel className="flex flex-col gap-0.5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6359]">
                  {user?.isAnonymous ? 'Guest Coaster' : 'Google Account'}
                </span>
                <span className="text-sm font-semibold text-[#1F1B18] truncate">
                  {user?.displayName || user?.email || 'Guest Table'}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[#E8DFD1]" />
              {user?.isAnonymous && (
                <DropdownMenuItem
                  onClick={handleUpgradeAccount}
                  className="flex items-center gap-2 text-[#C26D2D] font-semibold text-xs p-3 cursor-pointer"
                >
                  <Cloud className="w-4 h-4" />
                  <span>Save Coaster with Google</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={handlePrivacyVaultAudit}
                className="flex items-center gap-2 font-medium text-xs p-3 cursor-pointer text-[#1F1B18]"
              >
                <ShieldCheck className="w-4 h-4 text-[#3F7D58]" />
                <span>Run Privacy Vault Review</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowTutorial(true)}
                className="flex items-center gap-2 font-medium text-xs p-3 cursor-pointer text-[#1F1B18]"
              >
                <Sparkles className="w-4 h-4 text-[#D97706]" />
                <span>Coaster Quick Tour</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[#E8DFD1]" />
              <DropdownMenuItem
                onClick={() => signOut(auth)}
                className="text-[#9A4E16] font-medium text-xs p-3 cursor-pointer"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <LocalAiTelemetryBar />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex-1 flex flex-col h-full overflow-hidden"
        >
          <div className="flex-1 relative overflow-hidden h-full">
            {activeTab === 'chat' && (
              <div className="h-full w-full absolute inset-0 flex flex-col">
                <ChatInterface onSwitchToMetrics={() => handleTabChange('daily')} />
              </div>
            )}

            {activeTab === 'daily' && (
              <div
                ref={dailyScrollRef}
                className="h-full w-full absolute inset-0 overflow-y-auto overscroll-y-contain"
              >
                <div
                  className="flex items-center justify-center overflow-hidden transition-all duration-150"
                  style={{ height: isPullRefreshing ? 48 : Math.round(pullDistance * 0.55) }}
                >
                  {isPullRefreshing ? (
                    <Loader2 className="w-5 h-5 animate-spin text-[#C26D2D]" />
                  ) : pullDistance > 0 ? (
                    <RefreshCw
                      className="w-5 h-5 text-[#C26D2D]/70"
                      style={{
                        transform: `rotate(${Math.min((pullDistance / PULL_THRESHOLD) * 180, 180)}deg)`,
                        opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
                      }}
                    />
                  ) : null}
                </div>
                <DashboardCards data={healthData} isLoading={isHealthLoading} />
              </div>
            )}

            {activeTab === 'trends' && (
              <div className="h-full w-full absolute inset-0 overflow-y-auto p-3 sm:p-6 space-y-4">
                <div className="max-w-5xl mx-auto rounded-2xl border border-[#E8DFD1] bg-[#FFFDF9] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#C26D2D]">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Cloud + On-Device Hybrid Insight</span>
                    </div>
                    <h2 className="text-lg font-semibold text-[#1F1B18] font-['Newsreader',Georgia,serif]">
                      Sunny&apos;s 30-Day Trend Spotter
                    </h2>
                    <p className="text-xs text-[#6E6359]">
                      Spot weekly patterns, clear-day streaks, beverage mix, and fresh zero-proof
                      swap ideas.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setEarningsModalOpen(true)}
                    className="rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] text-xs font-semibold px-4 h-10 shrink-0 gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Open 30D Trend Spotter
                  </Button>
                </div>

                <HistoryView />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="h-full w-full absolute inset-0 overflow-y-auto p-3 sm:p-6 space-y-6">
                {/* Privacy Vault On-Device Audit Card */}
                <div className="max-w-4xl mx-auto rounded-2xl border border-[#3F7D58]/30 bg-[#FFFDF9] p-4 sm:p-5 space-y-3 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#3F7D58]">
                        <Lock className="w-3.5 h-3.5" />
                        <span>InferenceMode.ONLY_ON_DEVICE</span>
                      </div>
                      <h2 className="text-base font-semibold text-[#1F1B18]">
                        Privacy Vault On-Device Review
                      </h2>
                      <p className="text-xs text-[#6E6359]">
                        Synthesize your 30-day drink &amp; clear-day summary locally with Chrome
                        Gemini Nano—zero cloud transmission.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isAuditing}
                      onClick={handlePrivacyVaultAudit}
                      className="rounded-xl bg-[#3F7D58] hover:bg-[#316345] text-[#FFFDF9] text-xs font-semibold h-10 px-4 shrink-0 gap-1.5"
                    >
                      {isAuditing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5" />
                      )}
                      Run Local Audit
                    </Button>
                  </div>

                  {vaultAlert && (
                    <SecComplianceAlertPanel
                      alert={vaultAlert}
                      onWarmNano={warmNano}
                      onDisableLock={() => {
                        setSecPrivacyLock(false);
                        setVaultAlert(null);
                      }}
                    />
                  )}

                  {vaultAuditSummary && (
                    <div className="rounded-xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#2B5C3F]">
                          {vaultAuditSummary.headline}
                        </span>
                        {vaultAuditSummary.receipt && (
                          <ExecutionReceiptBadge
                            compact
                            inferenceSource={vaultAuditSummary.receipt.inferenceSource}
                            latencyMs={vaultAuditSummary.receipt.latencyMs}
                          />
                        )}
                      </div>
                      <p className="text-xs text-[#1F1B18] leading-relaxed">
                        {vaultAuditSummary.summary}
                      </p>
                    </div>
                  )}
                </div>

                <PreferencesView />
                <AboutView />
              </div>
            )}
          </div>

          {/* 4-Tab Bottom Navigation Bar */}
          <TabsList className="grid grid-cols-4 h-14 md:h-20 bg-[#FFFDF9] border-t border-[#E8DFD1] rounded-none shrink-0 p-0 gap-0 pb-[env(safe-area-inset-bottom)]">
            <TabsTrigger
              value="chat"
              className="flex flex-col gap-1 h-full rounded-none text-[#6E6359] data-[state=active]:bg-[#FAF6F0] data-[state=active]:text-[#C26D2D] transition-all"
            >
              <MessageCircle className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-[10px] font-semibold tracking-wide">Sunny</span>
            </TabsTrigger>
            <TabsTrigger
              value="daily"
              className="flex flex-col gap-1 h-full rounded-none text-[#6E6359] data-[state=active]:bg-[#FAF6F0] data-[state=active]:text-[#C26D2D] transition-all"
            >
              <GlassWater className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-[10px] font-semibold tracking-wide">Today</span>
            </TabsTrigger>
            <TabsTrigger
              value="trends"
              className="flex flex-col gap-1 h-full rounded-none text-[#6E6359] data-[state=active]:bg-[#FAF6F0] data-[state=active]:text-[#C26D2D] transition-all"
            >
              <TrendingUp className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-[10px] font-semibold tracking-wide">Trends</span>
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="flex flex-col gap-1 h-full rounded-none text-[#6E6359] data-[state=active]:bg-[#FAF6F0] data-[state=active]:text-[#C26D2D] transition-all"
            >
              <Settings className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-[10px] font-semibold tracking-wide">Settings</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </main>
    </div>
  );
}
