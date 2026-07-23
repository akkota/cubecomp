import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import { ThemeProvider } from '@/components/theme/theme-provider';
import {
  DEFAULT_THEME_ID,
  LEGACY_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '@/lib/themes';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'CubeComp — Rubik\'s Cube Competitions',
  description: 'Create and participate in online Rubik\'s Cube competitions',
};

/** Runs before paint to restore theme and avoid FOUC. */
const themeInitScript = `
(function(){
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var legacy = ${JSON.stringify(LEGACY_THEME_STORAGE_KEY)};
    var ids = ['light','dark','arcade','sunset','mint','candy','terminal','cosmic'];
    var darkIds = { dark:1, arcade:1, sunset:1, terminal:1, cosmic:1 };
    var raw = localStorage.getItem(key) || localStorage.getItem(legacy);
    var id = (raw && ids.indexOf(raw) !== -1) ? raw : ${JSON.stringify(DEFAULT_THEME_ID)};
    var root = document.documentElement;
    root.setAttribute('data-theme', id);
    if (darkIds[id]) root.classList.add('dark');
    else root.classList.remove('dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(DEFAULT_THEME_ID)});
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans antialiased`}
      >
        <ThemeProvider>
          <Navbar />
          <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
            {children}
          </main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
