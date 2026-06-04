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
        <div className="max-w-5xl mx-auto px-4 flex items-center gap-1 h-14">
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

      {/* Mobile top nav */}
      <nav className="sm:hidden bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center h-13">
          <span className="font-bold text-sm text-blue-600 tracking-tight px-3 shrink-0">PT Follow-up</span>
          <div className="flex flex-1 overflow-x-auto scrollbar-none">
            {links.map((l) => {
              const active = path === l.href
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`flex items-center gap-1.5 px-3 py-3.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                    active
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500'
                  }`}
                >
                  <span className="text-base leading-none">{l.icon}</span>
                  {l.label}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>
    </>
  )
}
