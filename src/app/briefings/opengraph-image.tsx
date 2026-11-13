import { ImageResponse } from 'next/og';

export const alt = 'Coaster — Gentle Morning & Evening Email Companion';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#FAF6F0',
          color: '#1F1B18',
          padding: '60px 68px',
          fontFamily: 'sans-serif',
          border: '12px solid #E8DFD1',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                background: '#C26D2D',
                color: '#FFFDF9',
                fontWeight: 800,
                fontSize: 20,
                padding: '10px 22px',
                borderRadius: 999,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              COASTER · +COASTER@ EMAIL COMPANION
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#6E6359' }}>
            Sunny · Mindful Drink Tally
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              fontSize: 62,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: -1.2,
              color: '#1F1B18',
            }}
          >
            Gentle 2x/Day Check-Ins Straight From Your Inbox.
          </div>
          <div style={{ fontSize: 26, color: '#6E6359', lineHeight: 1.4, maxWidth: 980 }}>
            Reply in plain English (&ldquo;2 hazy IPAs&rdquo;) or snap a can label. Standard Drink Units tracked without judgment.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 22 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#FFFDF9',
              border: '2px solid #C26D2D',
              borderRadius: 22,
              padding: '22px 28px',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 800, color: '#C26D2D', letterSpacing: 1.4 }}>
              9:00 AM · MORNING CHECK-IN
            </span>
            <span style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: '#1F1B18' }}>
              Yesterday: 1.5u Wine · 7-Day Avg: 1.1u/day
            </span>
            <span style={{ fontSize: 18, marginTop: 8, color: '#6E6359' }}>
              Tap to adjust yesterday or open your zero-login Live Coaster.
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#EAF3ED',
              border: '2px solid #3F7D58',
              borderRadius: 22,
              padding: '22px 28px',
              flex: 1,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 800, color: '#2B5C3F', letterSpacing: 1.4 }}>
              7:00 PM · EVENING CHECK-IN
            </span>
            <span style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: '#1F1B18' }}>
              Log 1.0u Beer · 1.0u Wine · 0.0u Clear Day
            </span>
            <span style={{ fontSize: 18, marginTop: 8, color: '#2B5C3F' }}>
              Or reply to Sunny with what is in your glass.
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
