'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { submitContactForm } from '@/app/actions/contact';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import {
  Cpu,
  Leaf,
  Loader2,
  Lock,
  MessageSquare,
  Scale,
  Send,
  Sparkles,
  Wine,
} from 'lucide-react';

export function AboutView() {
  const { user } = useUser();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await submitContactForm({
        name: name || user?.displayName || 'Coaster Visitor',
        email: email || user?.email || '',
        message,
        uid: user?.uid,
        context: 'about_view',
      });
      if (!res.success) throw new Error(res.error || 'Could not send message.');
      setMessage('');
      toast({
        title: 'Message received',
        description: 'Thanks for writing to us.',
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Could not send note',
        description: err instanceof Error ? err.message : 'Please try again shortly.',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-3xl overflow-hidden">
        <CardHeader className="pb-4 bg-gradient-to-br from-[#FFFDF9] via-[#FAF6F0] to-[#F5EBDC] border-b border-[#E8DFD1]">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#C26D2D]">
            About Coaster
          </p>
          <CardTitle className="text-2xl font-black text-[#1F1B18] tracking-tight">
            Honest Drink Math. Zero Judgment.
          </CardTitle>
          <CardDescription className="text-sm text-[#6E6359] leading-relaxed pt-1">
            Coaster is your quiet booth-buddy for noticing drinking rhythms over weeks and months
            — without broken-streak guilt, wagging fingers, or clutter.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 space-y-2">
            <div className="flex items-center gap-2 text-[#C26D2D]">
              <Scale className="w-4 h-4" />
              <h3 className="text-sm font-bold text-[#1F1B18]">
                NIAAA Standard Drink Units
              </h3>
            </div>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              In Coaster, <strong className="text-[#1F1B18]">1.0u</strong> matches the NIAAA
              reference standard of <strong className="text-[#1F1B18]">14 grams (0.6 fl oz)</strong>{' '}
              of pure ethanol (<code className="text-[#1F1B18]">oz × ABV% ÷ 60</code>). That equals
              one 12 oz 5% beer, a 5 oz 12% wine pour, or 1.5 oz of 80-proof spirits — while a tall
              16 oz 7% IPA counts cleanly as <strong className="text-[#1F1B18]">1.9u</strong>.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 space-y-2">
            <div className="flex items-center gap-2 text-[#3F7D58]">
              <Sparkles className="w-4 h-4" />
              <h3 className="text-sm font-bold text-[#1F1B18]">
                Meet Sunny, Your Booth-Buddy
              </h3>
            </div>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              Sunny keeps an eye on your 7-day rolling average, weeknight-to-weekend rhythm, and
              Clear Days without lecturing. When you want to shift gears mid-evening, Sunny offers
              flavor-matched zero-proof swaps and casual craft trivia.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 space-y-2">
            <div className="flex items-center gap-2 text-[#3F7D58]">
              <Leaf className="w-4 h-4" />
              <h3 className="text-sm font-bold text-[#1F1B18]">
                Clear Days &amp; Zero-Proof Swaps
              </h3>
            </div>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              Logging a <strong className="text-[#3F7D58]">Clear Day (0.0u)</strong> or an
              alcohol-free pour earns warm sage credit on your 90-day calendar so empty nights count
              deliberately — and social nights simply show up in honest amber tones.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 space-y-2">
            <div className="flex items-center gap-2 text-[#C26D2D]">
              <Wine className="w-4 h-4" />
              <h3 className="text-sm font-bold text-[#1F1B18]">
                Designed for Speed at the Table
              </h3>
            </div>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              1-tap drink presets, an interactive oz/mL + ABV calculator, and OS Share Sheet support
              mean a pour is recorded in under three seconds — and moves easily to &ldquo;last
              night&rdquo; if you remember the morning after.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Hybrid AI Explanation */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
          <CardTitle className="text-base font-bold text-[#1F1B18] flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#C26D2D]" />
            How Coaster&apos;s Hybrid AI Works
          </CardTitle>
          <CardDescription className="text-xs text-[#6E6359]">
            Choose between on-device speed, strict local privacy, or multi-month cloud synthesis.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-3.5 space-y-1.5">
            <p className="text-xs font-black text-[#C26D2D]">PREFER_ON_DEVICE</p>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              Uses browser-native Gemini Nano first for instant pour parsing and quick notes,
              falling back smoothly to cloud Gemini when hardware Nano is unavailable.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF6F0] border border-[#3F7D58]/35 p-3.5 space-y-1.5">
            <p className="text-xs font-black text-[#3F7D58] flex items-center gap-1">
              <Lock className="w-3 h-3" />
              ONLY_ON_DEVICE (Privacy Vault)
            </p>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              Locks all AI requests onto local on-device inference inside Preferences. Nothing leaves
              your device for AI parsing while Privacy Vault is switched on.
            </p>
          </div>

          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-3.5 space-y-1.5">
            <p className="text-xs font-black text-[#1F1B18]">PREFER_IN_CLOUD</p>
            <p className="text-xs text-[#6E6359] leading-relaxed">
              Uses server-side Gemini inference for multi-month pattern Q&amp;A, shared drink-card
              parsing, and optional weekly recap emails.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Feedback & Legal Links */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
          <CardTitle className="text-base font-bold text-[#1F1B18] flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#C26D2D]" />
            Questions or Feedback?
          </CardTitle>
          <CardDescription className="text-xs text-[#6E6359]">
            Coaster is designed for mindful reflection, not medical diagnosis.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-4 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
                className="h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
              />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address (optional)"
                className="h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
              />
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share a note with Sunny's builders..."
              rows={3}
              className="bg-[#FAF6F0] border-[#E8DFD1] text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={sending || !message.trim()}
              className="rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] px-4 text-xs font-bold"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1.5" />
              )}
              Send Message
            </Button>
          </form>

          <div className="pt-3 border-t border-[#E8DFD1]/70 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E6359]">
            <span>Coaster • Mindful Standard Drink Ledger</span>
            <div className="flex items-center gap-4 font-semibold">
              <Link href="/privacy" className="hover:text-[#1F1B18] underline underline-offset-4">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-[#1F1B18] underline underline-offset-4">
                Terms of Service
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
