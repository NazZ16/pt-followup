import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Nav from './nav'
import InstallPrompt from './install-prompt'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'PT Follow-up',
  description: 'Gestão de follow-up e finanças para personal trainer',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'PT Follow-up',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#2563EB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={`${geist.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#F4F6F9] text-gray-900 font-sans">
        <Nav />
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-4 pb-6">{children}</main>
        <InstallPrompt />
      </body>
    </html>
  )
}
