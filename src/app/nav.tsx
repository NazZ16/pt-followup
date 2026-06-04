'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Hoje' },
  { href: '/alunos', label: 'Alunos' },
  { href: '/financeiro', label: 'Financeiro' },
  { href: '/config', label: 'Config' },
]

export default function Nav() {
  const path = usePathname()
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-4 flex items-center gap-1 h-12">
        <span className="font-semibold text-sm mr-4 text-blue-600">PT Follow-up</span>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
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
  )
}
