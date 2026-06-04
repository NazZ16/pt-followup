'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Hoje', icon: '📅' },
  { href: '/alunos', label: 'Alunos', icon: '👤' },
  { href: '/financeiro', label: 'Financeiro', icon: '💶' },
  { href: '/config', label: 'Config', icon: '⚙️' },
]

export default function Nav() {
  const path = usePathname()
  return (
    <>
      {/* Desktop top nav */}
      <nav className="hidden sm:block bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 flex items-center gap-1 h-14">
          <span className="font-bold text-base mr-5 text-blue-600 tracking-tight">PT Follow-up</span>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                path === l.href
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Mobile top bar */}
      <div className="sm:hidden bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="px-4 h-12 flex items-center">
          <span className="font-bold text-base text-blue-600 tracking-tight">PT Follow-up</span>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 shadow-[0_-1px_8px_rgba(0,0,0,0.08)]">
        <div className="grid grid-cols-4">
          {links.map((l) => {
            const active = path === l.href
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                  active ? 'text-blue-600' : 'text-gray-500'
                }`}
              >
                <span className="text-lg leading-none">{l.icon}</span>
                <span className={`text-[10px] font-medium ${active ? 'text-blue-600' : 'text-gray-500'}`}>{l.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
