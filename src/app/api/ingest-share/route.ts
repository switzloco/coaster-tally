import { NextResponse } from 'next/server';
import { shareIngestionFlow } from '@/ai/flows/share-ingestion';
import { verifyAuthHeader } from '@/firebase/admin';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/ingest-share
 * Receives shared drink notes, ABV/menu URLs, or bottle/receipt photos from /incoming-share,
 * parses NIAAA Standard Drink Units via Sunny's Share Ingestion flow, and writes to Firestore.
 */
export async function POST(req: Request) {
  try {
    const uid = await verifyAuthHeader(req);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit(uid, 'chat');
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Rate limit hit (${limit.scope}). Try again in ${limit.retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await req.json();
    const {
      rawText,
      sourceTitle,
      sourceUrl,
      photoDataUris,
      imageDataUri,
      localDate,
      localTime,
    } = body as {
      rawText?: string;
      sourceTitle?: string;
      sourceUrl?: string;
      photoDataUris?: Array<{ dataUri: string; contentType?: string }>;
      imageDataUri?: string;
      localDate?: string;
      localTime?: string;
    };

    const normalizedPhotos: Array<{ dataUri: string; contentType: string }> = [
      ...(Array.isArray(photoDataUris)
        ? photoDataUris
            .filter((p) => p && typeof p.dataUri === 'string' && p.dataUri.startsWith('data:'))
            .map((p) => ({ dataUri: p.dataUri, contentType: p.contentType || 'image/jpeg' }))
        : []),
      ...(typeof imageDataUri === 'string' && imageDataUri.startsWith('data:')
        ? [{ dataUri: imageDataUri, contentType: 'image/jpeg' }]
        : []),
    ].slice(0, 3);

    const cleanText = typeof rawText === 'string' ? rawText.trim() : '';
    if (!cleanText && normalizedPhotos.length === 0) {
      return NextResponse.json(
        { error: 'Missing shared drink note or photo.' },
        { status: 400 },
      );
    }

    const result = await shareIngestionFlow({
      userId: uid,
      rawText: cleanText || '[Shared beverage photo]',
      sourceTitle: sourceTitle || undefined,
      sourceUrl: sourceUrl || undefined,
      photoDataUris: normalizedPhotos.length > 0 ? normalizedPhotos : undefined,
      localDate: localDate || new Date().toISOString().split('T')[0],
      localTime: localTime || new Date().toTimeString().slice(0, 5),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[IngestShare] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
