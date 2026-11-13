'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { createMealShare } from '@/app/actions/share-meal';
import { shareUrl } from '@/lib/share-text';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2, Share2 } from 'lucide-react';

export interface ShareMealButtonProps {
  foodLogIds: string[];
  label?: string;
  mealName?: string;
}

export function ShareMealButton({
  foodLogIds,
  label = 'Share pour',
  mealName,
}: ShareMealButtonProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Sign in required',
        description: 'Sign in to create a shareable Coaster card.',
      });
      return;
    }
    if (foodLogIds.length === 0) return;

    setSharing(true);
    try {
      const userName = user.displayName || 'Coaster Member';
      const res = await createMealShare(user.uid, foodLogIds, userName);
      if (!res || !res.success || !('shareId' in res) || !res.shareId) {
        throw new Error(
          res && !res.success && res.error ? res.error : 'Could not generate share link.'
        );
      }

      const url = shareUrl(res.shareId);
      const title = mealName ? `Coaster: ${mealName}` : 'Coaster Pour Card';

      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title, url });
          toast({ title: 'Coaster card shared' });
          return;
        } catch {
          // fall back to clipboard copy if user dismissed native sheet
        }
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        toast({
          title: 'Share link copied',
          description: 'Paste it anywhere to show this round.',
        });
      }
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Could not share',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
      });
    } finally {
      setSharing(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={sharing || foodLogIds.length === 0}
      onClick={handleShare}
      className="h-7 px-2.5 text-xs font-semibold rounded-full border-[#E8DFD1] bg-[#FFFDF9] text-[#1F1B18] hover:border-[#C26D2D]"
    >
      {sharing ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : copied ? (
        <Check className="w-3 h-3 mr-1 text-[#3F7D58]" />
      ) : (
        <Share2 className="w-3 h-3 mr-1 text-[#C26D2D]" />
      )}
      {copied ? 'Copied' : label}
    </Button>
  );
}
