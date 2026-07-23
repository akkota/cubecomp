import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'CubeComp — Rubik\'s Cube Competitions',
  description: 'Create and participate in online Rubik\'s Cube competitions',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} min-h-screen bg-background font-sans antialiased`}>
        <Navbar />
        <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
