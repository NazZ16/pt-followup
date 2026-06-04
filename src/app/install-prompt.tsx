'use client'

import { useEffect, useState } from 'react'

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<Event & { prompt: () => Promise<void> } | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Already installed (standalone mode) — don't show
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as Event & { prompt: () => Promise<void> })
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!visible || !prompt) return null

  async function instalar() {
    await prompt!.prompt()
    setVisible(false)
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3">
        <div className="text-2xl shrink-0">📲</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900">Instalar PT Follow-up</p>
          <p className="text-xs text-gray-500 mt-0.5">Adicione ao ecrã inicial para acesso rápido, sem browser.</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={instalar}
              className="flex-1 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Instalar
            </button>
            <button
              onClick={() => setVisible(false)}
              className="text-sm px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Agora não
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
