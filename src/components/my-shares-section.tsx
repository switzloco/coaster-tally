'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase';
import { getMyShares, revokeShare } from '@/app/actions/share-meal';
import { shareUrl } from '@/lib/share-text';
import { formatUnits } from '@/lib/drink-units';
import { useToast } from '@/hooks/use-toast';
import { Copy, ExternalLink, Loader2, Share2, Trash2 } from 'lucide-react';

interface ShareListItem {
  id: string;
  title?: string;
  totals?: {
    standardUnits?: number;
    alcoholDrinks?: number;
    calories?: number;
  };
  viewCount?: number;
  logCount?: number;
  revoked?: boolean;
}

export function MySharesSection() {
  const { user } = useUser();
  const { toast } = useToast();

  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await getMyShares(user.uid);
      if (res.success) {
        setShares(
          (res.shares as unknown as ShareListItem[]).filter((s) => !s.revoked)
        );
      }
    } catch {
      // silent load fallback
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  const handleCopy = async (shareId: string) => {
    const url = shareUrl(shareId);
    await navigator.clipboard?.writeText(url);
    toast({
      title: 'Link copied',
      description: 'Coaster round URL copied to clipboard.',
    });
  };

  const handleRevoke = async (shareId: string) => {
    if (!user) return;
    setRevokingId(shareId);
    try {
      const res = await revokeShare(user.uid, shareId);
      if (!res.success) {
        throw new Error(res.error || 'Could not revoke link');
      }
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      toast({
        title: 'Share link revoked',
        description: 'This link can no longer be viewed publicly.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not revoke link',
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (!user || (!loading && shares.length === 0)) return null;

  return (
    <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
        <CardTitle className="text-base font-bold text-[#1F1B18] flex items-center gap-2">
          <Share2 className="w-4 h-4 text-[#C26D2D]" />
          Shared Coaster Cards ({shares.length})
        </CardTitle>
        <CardDescription className="text-xs text-[#6E6359]">
          Rounds and drink cards you&apos;ve shared. Revoke a link anytime.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-4 space-y-2.5">
        {loading && shares.length === 0 ? (
          <div className="py-4 text-center text-xs text-[#6E6359]">Loading shared links...</div>
        ) : (
          shares.map((item) => {
            const units =
              item.totals?.standardUnits ?? item.totals?.alcoholDrinks;
            const heading = item.title || 'Shared Coaster Card';

            return (
              <div
                key={item.id}
                className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-bold text-[#1F1B18] truncate">{heading}</p>
                  <p className="text-[11px] text-[#6E6359]">
                    {typeof units === 'number' && (
                      <span className="font-bold text-[#C26D2D] tabular-nums mr-1.5">
                        {formatUnits(Math.round(units * 10) / 10)} •
                      </span>
                    )}
                    {typeof item.viewCount === 'number' ? `${item.viewCount} views` : 'Active'}
                    {typeof item.logCount === 'number' && item.logCount > 0
                      ? ` • ${item.logCount} saved`
                      : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => handleCopy(item.id)}
                    aria-label="Copy share link"
                    className="h-8 w-8 text-[#6E6359] hover:text-[#1F1B18]"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    asChild
                    aria-label="Open shared card"
                    className="h-8 w-8 text-[#6E6359] hover:text-[#1F1B18]"
                  >
                    <Link href={`/m/${item.id}`}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={revokingId === item.id}
                    onClick={() => handleRevoke(item.id)}
                    aria-label="Revoke share link"
                    className="h-8 w-8 text-[#6E6359] hover:text-[#C26D2D]"
                  >
                    {revokingId === item.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
