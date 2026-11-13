'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Send,
  Camera,
  X,
  Loader2,
  Images,
  Mic,
  Square,
  Search,
  Terminal,
  Sunrise,
  Sparkles,
} from 'lucide-react';
import { useTranscription } from '@/hooks/use-transcription';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp, useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { ChatMessage } from '@/lib/food-exercise-types';
import { HealthData, UserPreferences } from '@/lib/health-service';
import { SHARE_OFFER_SENTINEL, type ChatShareOffer } from '@/lib/share-offer';
import { ShareMealButton } from '@/components/share-meal-button';
import { OutreachInlinePrompt } from '@/components/outreach-inline-prompt';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import {
  ExecutionReceiptBadge,
  SecComplianceAlertPanel,
} from '@/components/execution-receipt-badge';
import { HybridTickerTerminal } from '@/components/hybrid-ticker-terminal';
import {
  dataUriToInlineImage,
  runHybridCoachTurn,
  SecPrivacyLockBlockedError,
  type NormalizedInferenceSource,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';
import {
  loadGIS,
  getPhotosPickerToken,
  createPickerSession,
  waitForPickerSelection,
  getPickerMediaItems,
  downloadMediaItem,
  deletePickerSession,
  extractTimestampFromMediaItem,
} from '@/lib/google-photos-picker';

interface Message {
  role: 'user' | 'model';
  content: string;
  images?: string[];
  shareOffer?: ChatShareOffer;
  inferenceSource?: NormalizedInferenceSource;
  inferenceLatencyMs?: number;
  secAlert?: SecComplianceAlert;
}

function parseShareOffer(raw: string): { text: string; offer?: ChatShareOffer } {
  const idx = raw.indexOf(SHARE_OFFER_SENTINEL);
  if (idx === -1) return { text: raw };
  const text = raw.slice(0, idx);
  const json = raw.slice(idx + SHARE_OFFER_SENTINEL.length);
  try {
    const offer = JSON.parse(json) as ChatShareOffer;
    if (offer?.foodLogIds?.length) return { text, offer };
  } catch {
    // Incomplete or malformed trailing share payload
  }
  return { text };
}

interface SelectedPhoto {
  dataUri: string;
  exifTime?: string;
  exifDate?: string;
}

const MAX_PHOTOS = 5;

const SUNNY_QUICK_PROMPTS = [
  '2 craft IPAs at trivia',
  'Glass of pinot noir',
  'Clear day today',
  'Suggest a fun zero-proof swap',
];

async function extractExifInfo(file: File): Promise<{ time?: string; date?: string }> {
  try {
    const exifr = await import('exifr');
    const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const dt: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) {
      return {
        time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
        date: dt.toLocaleDateString('en-CA'),
      };
    }
  } catch {
    // Fall back to file.lastModified
  }
  if (file.lastModified) {
    const d = new Date(file.lastModified);
    return {
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      date: d.toLocaleDateString('en-CA'),
    };
  }
  return {};
}

function readFileAsDataUri(file: File, maxDim = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new globalThis.Image();
      img.onerror = () => resolve(e.target?.result as string);
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width <= maxDim && height <= maxDim) {
          resolve(e.target?.result as string);
          return;
        }
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export interface ChatInterfaceProps {
  onSwitchToMetrics?: () => void;
}

export function ChatInterface({ onSwitchToMetrics: _onSwitchToMetrics }: ChatInterfaceProps = {}) {
  const firebaseApp = useFirebaseApp();
  const { user } = useUser();
  const db = useFirestore();
  const {
    secPrivacyLock,
    setSecPrivacyLock,
    warmNano,
    isOnline,
    recordReceipt,
  } = useHybridAi();
  const [messages, setMessages] = useState<Message[]>([]);
  const [initDone, setInitDone] = useState(false);
  const [chatRequested, setChatRequested] = useState(false);
  const [showShorthandDrawer, setShowShorthandDrawer] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerAbortRef = useRef<AbortController | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { status: micStatus, toggle: toggleMic, error: micError } = useTranscription(
    useCallback((text: string) => setInput((prev) => (prev ? `${prev} ${text}` : text)), []),
    useCallback(() => user!.getIdToken(), [user])
  );

  useEffect(() => {
    if (micError) {
      toast({ title: 'Voice input error', description: micError, variant: 'destructive' });
    }
  }, [micError, toast]);

  const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

  const userDocRef = useMemoFirebase(() => (user ? doc(db, 'users', user.uid) : null), [db, user]);
  const { data: healthData, isLoading: healthLoading } = useDoc<HealthData>(userDocRef);

  const prefsDocRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [db, user]
  );
  const { data: prefs, isLoading: prefsLoading } = useDoc<UserPreferences>(prefsDocRef);

  const autoChatEnabled = prefs?.autoChatEnabled ?? false;

  useEffect(() => {
    if (initDone || !user || healthLoading || prefsLoading || !prefs || !healthData) return;

    let cancelled = false;
    const now = new Date();
    const today =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');

    const runInit = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'chat_sessions', today));
        if (cancelled) return;
        const stored = (snap.exists() ? snap.data()?.messages : null) as
          | ChatMessage[]
          | null
          | undefined;
        if (stored && stored.length > 0) {
          setMessages(stored.map((m) => ({ role: m.role, content: m.content })));
          setInitDone(true);
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.warn('[ChatInit] transcript restore failed:', e);
      }
      if (cancelled) return;

      if (!autoChatEnabled && !chatRequested) return;
      if (secPrivacyLock || !isOnline) {
        setInitDone(true);
        setMessages([
          {
            role: 'model',
            content: secPrivacyLock
              ? "**Privacy Vault Active (`ONLY_ON_DEVICE`)**\n\nEverything you share stays strictly on this device with Chrome Gemini Nano. Tell me what's in your glass, or type **\"Clear day\"**."
              : '**Offline Coaster Ready (`PREFER_ON_DEVICE`)**\n\nYou are offline right now, and your local coaster ledger + on-device parser are still ready whenever you want to tally a pour.',
          },
        ]);
        return;
      }
      setInitDone(true);

      setIsLoading(true);
      const initStartedAt = performance.now();
      try {
        const sanitizedHealth = healthData ? JSON.parse(JSON.stringify(healthData)) : {};
        const idToken = await user.getIdToken();
        const payload = {
          message: '__init__',
          chatHistory: [],
          currentHealth: sanitizedHealth,
          userName: user.displayName || undefined,
          localDate: today,
          localTime: now.toLocaleTimeString('en-US'),
          modelTier: prefs?.aiModelTier ?? 'flash',
        };

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error('Could not start chat session');
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('Stream unavailable');

        setMessages([{ role: 'model', content: '' }]);
        setIsLoading(false);

        const decoder = new TextDecoder();
        let streamText = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          streamText += decoder.decode(value, { stream: true });

          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1].content = streamText;
            updated[updated.length - 1].inferenceSource = 'IN_CLOUD';
            updated[updated.length - 1].inferenceLatencyMs = Math.round(
              performance.now() - initStartedAt
            );
            return updated;
          });
        }
      } catch (e) {
        console.error('[ChatInit] stream error:', e);
        setMessages([
          {
            role: 'model',
            content:
              "Hey, I'm Sunny—pulled up a seat with a sparkling yuzu. Tell me what you're sipping, snap a bottle or menu, or say **Clear day** anytime.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    runInit();
    return () => {
      cancelled = true;
    };
  }, [
    healthData,
    healthLoading,
    prefs,
    prefsLoading,
    initDone,
    user,
    autoChatEnabled,
    chatRequested,
    db,
    secPrivacyLock,
    isOnline,
  ]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const processFiles = async (files: File[]) => {
    const slots = MAX_PHOTOS - selectedPhotos.length;
    if (slots <= 0) {
      toast({ title: `Max ${MAX_PHOTOS} photos per message`, variant: 'destructive' });
      return;
    }
    const toProcess = files.slice(0, slots);
    const results = await Promise.all(
      toProcess.map(async (file) => {
        const [dataUri, exif] = await Promise.all([
          readFileAsDataUri(file),
          extractExifInfo(file),
        ]);
        return { dataUri, exifTime: exif.time, exifDate: exif.date } satisfies SelectedPhoto;
      })
    );
    setSelectedPhotos((prev) => [...prev, ...results]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) await processFiles(files);
    e.target.value = '';
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageFiles: File[] = [];
    for (let i = 0; i < e.clipboardData.items.length; i++) {
      const item = e.clipboardData.items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length) await processFiles(imageFiles);
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const cancelPicker = useCallback(() => {
    pickerAbortRef.current?.abort();
    pickerAbortRef.current = null;
    setIsPickerOpen(false);
  }, []);

  const handleGooglePhotos = async () => {
    if (!GOOGLE_CLIENT_ID) {
      toast({
        variant: 'destructive',
        title: 'Google Photos not configured',
        description: 'Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your environment.',
      });
      return;
    }
    const slots = MAX_PHOTOS - selectedPhotos.length;
    if (slots <= 0) {
      toast({ title: `Max ${MAX_PHOTOS} photos per message`, variant: 'destructive' });
      return;
    }

    try {
      await loadGIS();
      const accessToken = await getPhotosPickerToken(GOOGLE_CLIENT_ID);
      const session = await createPickerSession(accessToken);

      window.open(session.pickerUri, '_blank');
      setIsPickerOpen(true);

      const abort = new AbortController();
      pickerAbortRef.current = abort;

      const selected = await waitForPickerSelection(session, accessToken, abort.signal);
      setIsPickerOpen(false);
      pickerAbortRef.current = null;

      if (!selected) {
        deletePickerSession(session.id, accessToken);
        return;
      }

      const items = await getPickerMediaItems(session.id, accessToken);
      deletePickerSession(session.id, accessToken);

      const photos = await Promise.all(
        items.slice(0, slots).map(async (item) => {
          const dataUri = await downloadMediaItem(item.mediaFile.baseUrl);
          const { time, date } = extractTimestampFromMediaItem(item);
          return { dataUri, exifTime: time, exifDate: date } satisfies SelectedPhoto;
        })
      );
      setSelectedPhotos((prev) => [...prev, ...photos]);
    } catch (err: any) {
      setIsPickerOpen(false);
      pickerAbortRef.current = null;
      if (err?.message?.includes('popup_closed') || err?.type === 'popup_closed') return;
      console.error('[GooglePhotos]', err);
      toast({
        variant: 'destructive',
        title: 'Google Photos failed',
        description: err?.message ?? 'Unknown error',
      });
    }
  };

  const EXPLAIN_PROMPT =
    'Show me the Standard Drink Unit math behind that—how many ounces, what ABV%, and how it compares to 0.6 fl oz pure alcohol per unit.';

  const handleSend = async (overrideText?: string) => {
    const hasPhotos = selectedPhotos.length > 0;
    const typedText = (overrideText ?? input).trim();
    if (!user || (!typedText && !hasPhotos) || isLoading) return;
    setInitDone(true);

    const userMessage = typedText;
    const photos = selectedPhotos;
    const now = new Date();
    const localDate =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');

    if (overrideText === undefined) setInput('');
    setSelectedPhotos([]);
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content:
          userMessage || (photos.length > 1 ? `${photos.length} photos attached` : 'Photo attached'),
        images: photos.map((p) => p.dataUri),
      },
    ]);
    setIsLoading(true);

    const sanitizedHealth = healthData ? JSON.parse(JSON.stringify(healthData)) : {};

    const photoTimestamps = photos.map((p) => p.exifTime ?? '');
    const photoDates = photos.map((p) => p.exifDate ?? '');
    let exifContext = '';
    if (photos.length > 0 && photos.some((p) => p.exifTime)) {
      const parts = photos.map(
        (p, i) =>
          `Photo ${i + 1}: taken at ${p.exifTime ?? 'unknown time'}${
            p.exifDate && p.exifDate !== localDate ? ` on ${p.exifDate}` : ''
          }`
      );
      exifContext = `[${parts.join(' | ')}] `;
    }
    const fullMessage = exifContext + userMessage;

    // Hybrid AI Client Path when Privacy Vault (`ONLY_ON_DEVICE`) is ON or offline (`PREFER_ON_DEVICE`)
    if (secPrivacyLock || !isOnline) {
      try {
        const inlineImages = photos.map((p) => dataUriToInlineImage(p.dataUri));
        const hybridRes = await runHybridCoachTurn({
          firebaseApp,
          userMessage: fullMessage || 'Check the beverage label or pour in this photo.',
          secPrivacyLock,
          healthData,
          preferences: prefs,
          attachedImages: inlineImages,
        });

        if (hybridRes.receipt) {
          recordReceipt(hybridRes.receipt);
        }

        setMessages((prev) => [
          ...prev,
          {
            role: 'model',
            content: hybridRes.replyText,
            inferenceSource: hybridRes.receipt?.inferenceSource ?? 'ON_DEVICE',
            inferenceLatencyMs: hybridRes.receipt?.latencyMs,
          },
        ]);
      } catch (err) {
        if (err instanceof SecPrivacyLockBlockedError) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'model',
              content: '',
              secAlert: err.alert,
            },
          ]);
        } else {
          const msg = err instanceof Error ? err.message : 'Local Hybrid AI unavailable.';
          setMessages((prev) => [
            ...prev,
            {
              role: 'model',
              content: `**On-Device / Offline Notice**\n\n${msg}`,
            },
          ]);
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const requestStartedAt = performance.now();
    try {
      const idToken = await user.getIdToken();
      const payload = {
        message: fullMessage,
        chatHistory: messages.map((m) => ({ role: m.role, content: m.content })),
        currentHealth: sanitizedHealth,
        userName: user.displayName || undefined,
        localDate,
        localTime: now.toLocaleTimeString('en-US'),
        photoDataUris: photos.map((p) => p.dataUri),
        photoTimestamps,
        photoDates,
        modelTier: prefs?.aiModelTier ?? 'flash',
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Sunny could not reply: ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Stream unavailable');

      setMessages((prev) => [...prev, { role: 'model', content: '' }]);
      setIsLoading(false);

      const decoder = new TextDecoder();
      let streamText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        streamText += decoder.decode(value, { stream: true });

        const { text } = parseShareOffer(streamText);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1].content = text;
          return updated;
        });
      }

      const totalLatencyMs = Math.round(performance.now() - requestStartedAt);
      const { text, offer } = parseShareOffer(streamText);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1].content = text;
        updated[updated.length - 1].inferenceSource = 'IN_CLOUD';
        updated[updated.length - 1].inferenceLatencyMs = totalLatencyMs;
        if (offer) updated[updated.length - 1].shareOffer = offer;
        return updated;
      });
    } catch (e: any) {
      console.error('[ChatSend] Error:', e);
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: `Sunny hit a momentary connection snag.\n\n*${
            e.message || 'Please try again in a moment, or toggle Shorthand & Scan below.'
          }*`,
        },
      ]);
      toast({
        variant: 'destructive',
        title: 'Connection Issue',
        description: e.message || 'Sunny is temporarily unreachable.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const inputPromptText = "Tell Sunny what's in your glass, say 'Clear day', or snap a label...";

  const GooglePhotosIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill="#4285F4" />
      <path d="M12 12 L20.5 12 A8.5 8.5 0 0 1 12 20.5 Z" fill="#34A853" />
      <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill="#FBBC05" />
      <path d="M12 12 L3.5 12 A8.5 8.5 0 0 1 12 3.5 Z" fill="#EA4335" />
    </svg>
  );

  const PhotoStrip =
    selectedPhotos.length > 0 || isPickerOpen ? (
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 px-1">
        {isPickerOpen && (
          <div className="flex-shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-20 rounded-xl border-2 border-dashed border-[#C26D2D]/40 bg-[#FAF6F0]">
            <Loader2 className="w-4 h-4 text-[#C26D2D] animate-spin" />
            <span className="text-[8px] font-semibold text-[#C26D2D] uppercase text-center leading-tight px-1">
              Picking…
            </span>
            <button
              onClick={cancelPicker}
              className="text-[8px] font-semibold text-[#B45309] underline leading-none"
            >
              cancel
            </button>
          </div>
        )}
        {selectedPhotos.map((photo, i) => (
          <div
            key={i}
            className="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 border-[#C26D2D] shadow-sm"
          >
            <Image
              src={photo.dataUri}
              alt={`Photo ${i + 1}`}
              width={80}
              height={80}
              className="w-full h-full object-cover"
              unoptimized
            />
            {photo.exifTime && (
              <div className="absolute bottom-0 left-0 right-0 bg-[#1F1B18]/75 text-[#FAF6F0] text-[8px] font-mono text-center py-0.5 leading-tight">
                {photo.exifTime}
                {photo.exifDate && photo.exifDate !== new Date().toLocaleDateString('en-CA') && (
                  <div className="text-[7px] opacity-80">{photo.exifDate.slice(5)}</div>
                )}
              </div>
            )}
            <Button
              size="icon"
              variant="destructive"
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full p-0"
              onClick={() => removePhoto(i)}
            >
              <X className="w-2.5 h-2.5" />
            </Button>
          </div>
        ))}
        {selectedPhotos.length < MAX_PHOTOS && (
          <button
            className="flex-shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-[#E8DFD1] flex items-center justify-center text-[#6E6359] hover:border-[#C26D2D] hover:text-[#C26D2D] transition-colors"
            onClick={() => galleryInputRef.current?.click()}
          >
            <span className="text-[9px] font-semibold uppercase text-center leading-tight px-1">
              Add
              <br />
              More
            </span>
          </button>
        )}
      </div>
    ) : null;

  const QuickSuggestionsStrip = (
    <div className="px-3 sm:px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
      {SUNNY_QUICK_PROMPTS.map((prompt) => (
        <Button
          key={prompt}
          variant="outline"
          size="sm"
          className="rounded-full text-[11px] font-medium border-[#E8DFD1] bg-[#FFFDF9] hover:bg-[#FAF6F0] text-[#4A4139] hover:text-[#1F1B18] whitespace-nowrap h-8 px-3"
          onClick={() => handleSend(prompt)}
        >
          <Sparkles className="w-3 h-3 mr-1.5 text-[#C26D2D]" />
          {prompt}
        </Button>
      ))}
    </div>
  );

  const InputBar = (
    <div className="p-2 sm:p-3 bg-[#FFFDF9]/90 backdrop-blur-md border-t border-[#E8DFD1] safe-area-bottom shrink-0">
      {PhotoStrip}

      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        ref={cameraInputRef}
        onChange={handleFileChange}
      />
      <input
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        ref={galleryInputRef}
        onChange={handleFileChange}
      />

      {/* Row 1 — camera, gallery, Google Photos, Hybrid Shorthand drawer, mic & send */}
      <div className="flex items-center gap-1.5 mb-2">
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-[#FAF6F0] border border-[#E8DFD1] hover:bg-[#F3ECE1]"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isLoading || isPickerOpen || selectedPhotos.length >= MAX_PHOTOS}
          title="Take photo of bottle, can, or menu"
        >
          <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-[#6E6359]" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-[#FAF6F0] border border-[#E8DFD1] hover:bg-[#F3ECE1]"
          onClick={() => galleryInputRef.current?.click()}
          disabled={isLoading || isPickerOpen || selectedPhotos.length >= MAX_PHOTOS}
          title="Choose photos from library (EXIF timestamps preserved)"
        >
          <Images className="w-4 h-4 sm:w-5 sm:h-5 text-[#6E6359]" />
        </Button>
        {GOOGLE_CLIENT_ID && (
          <Button
            variant="secondary"
            size="icon"
            className="rounded-full shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-[#FAF6F0] border border-[#E8DFD1] hover:bg-[#F3ECE1]"
            onClick={handleGooglePhotos}
            disabled={isLoading || isPickerOpen || selectedPhotos.length >= MAX_PHOTOS}
            title="Pick from Google Photos"
          >
            <GooglePhotosIcon className="w-4 h-4 sm:w-5 sm:h-5" />
          </Button>
        )}

        <button
          type="button"
          onClick={() => setShowShorthandDrawer((prev) => !prev)}
          data-testid="coach-ticker-drawer-btn"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 h-8 sm:h-9 font-mono text-[10px] font-semibold uppercase tracking-wider transition-all shrink-0 ${
            showShorthandDrawer
              ? 'border-[#C26D2D] bg-[#C26D2D] text-[#FFFDF9] shadow-xs'
              : 'border-[#E8DFD1] bg-[#FAF6F0] text-[#4A4139] hover:border-[#C26D2D]/50'
          }`}
          title="Toggle Hybrid Shorthand & Can / Menu Label Scanner"
        >
          <Terminal className="w-3 h-3 shrink-0" />
          <span className="sm:hidden">{showShorthandDrawer ? 'Hide' : 'Shorthand'}</span>
          <span className="hidden sm:inline">
            {showShorthandDrawer ? 'Hide Shorthand & Scan' : 'Shorthand & Label Scan'}
          </span>
        </button>

        <div className="flex-1" />

        <Button
          variant={micStatus === 'recording' ? 'destructive' : 'secondary'}
          size="icon"
          className={`rounded-full shrink-0 w-9 h-9 sm:w-10 sm:h-10 ${
            micStatus === 'recording'
              ? 'animate-pulse'
              : 'bg-[#FAF6F0] border border-[#E8DFD1] hover:bg-[#F3ECE1]'
          }`}
          onClick={toggleMic}
          disabled={isLoading || micStatus === 'transcribing'}
          title={
            micStatus === 'recording'
              ? 'Stop recording'
              : micStatus === 'transcribing'
                ? 'Transcribing...'
                : 'Voice input'
          }
        >
          {micStatus === 'recording' ? (
            <Square className="w-4 h-4" />
          ) : micStatus === 'transcribing' ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#C26D2D]" />
          ) : (
            <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-[#6E6359]" />
          )}
        </Button>

        <Button
          size="icon"
          className="rounded-full shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9]"
          onClick={() => handleSend()}
          disabled={isLoading || isPickerOpen || (!input.trim() && selectedPhotos.length === 0)}
          title="Send to Sunny"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>

      {/* Row 2 — auto-growing textarea */}
      <Textarea
        placeholder={inputPromptText}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        onPaste={handlePaste}
        rows={1}
        className="w-full rounded-2xl border-[#E8DFD1] bg-[#FAF6F0] text-[#1F1B18] placeholder:text-[#6E6359]/75 min-h-[44px] sm:min-h-[54px] max-h-[130px] resize-none px-3.5 py-2.5 text-base leading-snug focus-visible:ring-[#C26D2D]"
      />
    </div>
  );

  const HybridShorthandDrawer = showShorthandDrawer ? (
    <div className="border-b border-[#E8DFD1] bg-[#FAF6F0] p-2.5 sm:p-3 shrink-0 max-h-[56vh] overflow-y-auto">
      <HybridTickerTerminal
        compact
        healthData={healthData}
        onCommitted={() => setShowShorthandDrawer(false)}
      />
    </div>
  ) : null;

  // Idle standby view before first message
  if (!autoChatEnabled && messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col flex-1 h-0 bg-[#FAF6F0]">
        {HybridShorthandDrawer}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center overflow-y-auto">
          <div className="w-16 h-16 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] flex items-center justify-center shadow-sm">
            <Sunrise className="w-8 h-8 text-[#C26D2D]" />
          </div>
          <div className="space-y-1.5 max-w-md">
            <h2 className="text-2xl font-semibold tracking-tight text-[#1F1B18] font-['Newsreader',Georgia,serif]">
              Sunny is at the booth
            </h2>
            <p className="text-sm text-[#6E6359] leading-relaxed">
              Tally drinks honestly in Standard Drink Units, celebrate clear evenings, or ask for a
              crisp zero-proof swap.
            </p>
          </div>
          <Button
            className="h-12 px-7 rounded-2xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] text-sm font-semibold shadow-md"
            onClick={() => setChatRequested(true)}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Say Hey to Sunny
          </Button>
          <OutreachInlinePrompt
            variant="idle"
            outreach={prefs?.outreach}
            onEnrolled={async (res) => {
              if (res.deliveredNow && user) {
                try {
                  const now = new Date();
                  const today =
                    now.getFullYear() +
                    '-' +
                    String(now.getMonth() + 1).padStart(2, '0') +
                    '-' +
                    String(now.getDate()).padStart(2, '0');
                  const snap = await getDoc(doc(db, 'users', user.uid, 'chat_sessions', today));
                  const stored = (snap.exists() ? snap.data()?.messages : null) as
                    | ChatMessage[]
                    | null
                    | undefined;
                  if (stored && stored.length > 0) {
                    setMessages(stored.map((m) => ({ role: m.role, content: m.content })));
                    setInitDone(true);
                  }
                } catch {
                  // Non-fatal
                }
              }
            }}
          />
          <p className="text-xs text-[#6E6359]">
            Or tap a quick prompt below, speak into the mic, or attach a bottle photo.
          </p>
        </div>
        {QuickSuggestionsStrip}
        {InputBar}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-0 bg-[#FAF6F0]">
      {HybridShorthandDrawer}
      <ScrollArea className="flex-1 p-4 pt-3">
        <div className="flex flex-col gap-4 max-w-3xl mx-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'
              }
            >
              <div className="flex flex-wrap items-center gap-2 mb-1 px-1">
                <span className="text-[11px] font-semibold text-[#6E6359]">
                  {m.role === 'model' ? 'Sunny · Coaster' : 'You'}
                </span>
                {m.role === 'model' && m.inferenceSource && (
                  <ExecutionReceiptBadge
                    compact
                    inferenceSource={m.inferenceSource}
                    latencyMs={m.inferenceLatencyMs}
                  />
                )}
              </div>
              {m.secAlert ? (
                <SecComplianceAlertPanel
                  alert={m.secAlert}
                  onWarmNano={warmNano}
                  onDisableLock={() => setSecPrivacyLock(false)}
                  className="max-w-xl"
                />
              ) : (
                <div className={m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                  {m.images && m.images.length > 0 && (
                    <div
                      className={`mb-2 ${m.images.length > 1 ? 'grid grid-cols-2 gap-1.5' : ''}`}
                    >
                      {m.images.map((img, j) => (
                        <Image
                          key={j}
                          src={img}
                          alt={`Photo ${j + 1}`}
                          width={400}
                          height={300}
                          className="rounded-xl border border-[#E8DFD1] w-full h-auto"
                          unoptimized
                        />
                      ))}
                    </div>
                  )}
                  {m.role === 'model' ? (
                    <div className="prose prose-sm max-w-none text-[#1F1B18] prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-[#9A4E16] prose-headings:text-[#1F1B18]">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
              )}
              {m.role === 'model' && m.shareOffer && (
                <div className="mt-1.5 px-1">
                  <ShareMealButton
                    foodLogIds={m.shareOffer.foodLogIds}
                    label={m.shareOffer.label}
                  />
                </div>
              )}
              {m.role === 'model' &&
                i === messages.length - 1 &&
                i > 0 &&
                m.content.trim().length > 0 &&
                !isLoading && (
                  <div className="mt-1.5 px-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-[11px] font-medium text-[#6E6359] hover:text-[#C26D2D] hover:bg-[#FFFDF9] h-7 px-3"
                      onClick={() => handleSend(EXPLAIN_PROMPT)}
                      title="See how Sunny computed these Standard Drink Units"
                    >
                      <Search className="w-3 h-3 mr-1.5" />
                      Show unit math
                    </Button>
                  </div>
                )}
            </div>
          ))}
          {isLoading && (
            <div className="flex flex-col items-start">
              <div className="chat-bubble-ai flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C26D2D]" />
                <span className="text-xs font-medium text-[#6E6359]">Sunny is tallying...</span>
              </div>
            </div>
          )}
          <div ref={scrollRef} className="h-4" />
        </div>
      </ScrollArea>

      {!isLoading && messages.length <= 1 && QuickSuggestionsStrip}
      {InputBar}
    </div>
  );
}
