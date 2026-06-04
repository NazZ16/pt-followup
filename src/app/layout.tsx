import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Nav from './nav'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'PT Follow-up',
  description: 'Gestão de follow-up e finanças para personal trainer',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={`${geist.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900 font-sans">
        <Nav />
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
