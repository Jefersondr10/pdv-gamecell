import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'AtacadoApple PDV',
  applicationName: 'AtacadoApple PDV',
  description: 'Vendas, estoque e rastreabilidade por número de série.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      {
        url: '/icons/atacadoapple-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/icons/atacadoapple-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    title: 'AtacadoApple',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#07182c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
