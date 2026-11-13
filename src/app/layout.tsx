import type {Metadata, Viewport} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { AddToHomePrompt } from '@/components/add-to-home-prompt';
import Link from 'next/link';
import pkg from '../../package.json';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Coaster — Mindful Drink Tally & Trend Buddy',
  description:
    'Count pours in NIAAA Standard Drink Units, notice clear evenings, and explore weekly drink trends with Sunny, your non-judgmental booth-buddy powered by Hybrid AI (#BuildHybridAI).',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Coaster',
  },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  verification: {
    google: 'googlee89a7536a417e453',
  },
};

export const viewport: Viewport = {
  themeColor: '#C26D2D',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="origin-trial"
          content={
            process.env.NEXT_PUBLIC_CHROME_ORIGIN_TRIAL_TOKEN ||
            process.env.VITE_CHROME_ORIGIN_TRIAL_TOKEN ||
            ''
          }
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased bg-[#FAF6F0] text-[#1F1B18] min-h-[100dvh] flex flex-col">
        <FirebaseClientProvider>
          {children}
        </FirebaseClientProvider>
        <Toaster />
        <ServiceWorkerRegister />
        <AddToHomePrompt />
        <footer className="hidden md:flex w-full text-center text-[11px] text-[#6E6359] py-3 mt-auto border-t border-[#E8DFD1] bg-[#FAF6F0]/90 flex-col gap-1 items-center">
          <p>Coaster · Built for #BuildHybridAI · v {process.env.NEXT_PUBLIC_PR_NUMBER || pkg.version}</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-[#1F1B18] hover:underline">Privacy Policy</Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-[#1F1B18] hover:underline">Terms of Service</Link>
            <span>•</span>
            <a href="mailto:nicholas.switzer+coaster@gmail.com" className="hover:text-[#1F1B18] hover:underline">Support</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
