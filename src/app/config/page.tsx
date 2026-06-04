'use client'

import { useEffect, useState } from 'react'
import { supabase, NivelRemuneracao } from '@/lib/supabase'

interface ConfigFiscal {
  id: number
  taxa_irs: number
}

interface BonusConfig {
  id?: string
  trimestre: string
  threshold_horas: number
  valor_bonus: number
  horas_realizadas: number
  atingido: boolean
}

export default function ConfigPage() {
  const [niveis, setNiveis] = useState<NivelRemuneracao[]>([])
  const [fiscal, setFiscal] = useState<ConfigFiscal | null>(null)
  const [bonus, setBonus] = useState<BonusConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: n }, { data: f }, { data: b }] = await Promise.all([
      supabase.from('niveis_remuneracao').select('*').order('nivel'),
      supabase.from('config_fiscal').select('*').single(),
      supabase.from('bonus_trimestral').select('*').order('trimestre', { ascending: false }),
    ])
    setNiveis((n as NivelRemuneracao[]) || [])
    setFiscal(f as ConfigFiscal | null)
    setBonus((b as BonusConfig[]) || [])
    setLoading(false)
  }

  async function salvarNiveis() {
    setSaving(true)
    for (const n of niveis) {
      await supabase.from('niveis_remuneracao').update({
        valor_45min: n.valor_45min,
        valor_60min: n.valor_60min,
        horas_min: n.horas_min,
        horas_max: n.horas_max,
      }).eq('id', n.id)
    }
    setSaving(false)
    setMsg('Guardado com sucesso.')
    setTimeout(() => setMsg(''), 3000)
  }

  async function salvarFiscal() {
    if (!fiscal) return
    setSaving(true)
    await supabase.from('config_fiscal').update({ taxa_irs: fiscal.taxa_irs }).eq('id', fiscal.id)
    setSaving(false)
    setMsg('Guardado com sucesso.')
    setTimeout(() => setMsg(''), 3000)
  }

  async function salvarBonus(b: BonusConfig) {
    setSaving(true)
    if (b.id) {
      await supabase.from('bonus_trimestral').update({
        threshold_horas: b.threshold_horas,
        valor_bonus: b.valor_bonus,
      }).eq('id', b.id)
    } else {
      await supabase.from('bonus_trimestral').insert({
        trimestre: b.trimestre,
        threshold_horas: b.threshold_horas,
        valor_bonus: b.valor_bonus,
        horas_realizadas: 0,
        atingido: false,
      })
    }
    setSaving(false)
    setMsg('Guardado com sucesso.')
    setTimeout(() => setMsg(''), 3000)
    load()
  }

  function addBonus() {
    const hoje = new Date()
    const trim = `${hoje.getFullYear()}-Q${Math.ceil((hoje.getMonth() + 1) / 3)}`
    setBonus([...bonus, { trimestre: trim, threshold_horas: 0, valor_bonus: 0, horas_realizadas: 0, atingido: false }])
  }

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Configurações</h1>
      {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-2">{msg}</div>}

      {/* NÍVEIS DE REMUNERAÇÃO */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Níveis de remuneração</h2>
          <button
            onClick={salvarNiveis}
            disabled={saving}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Guardar
          </button>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Nível</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Horas mín.</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Horas máx.</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">45 min (€)</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">60 min (€)</th>
              </tr>
            </thead>
            <tbody>
              {niveis.map((n, i) => (
                <tr key={n.id} className={i < niveis.length - 1 ? 'border-b border-gray-100' : ''}>
                  <td className="px-4 py-2 font-medium">Nível {n.nivel}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={n.horas_min}
                      onChange={(e) => {
                        const copy = [...niveis]
                        copy[i] = { ...copy[i], horas_min: Number(e.target.value) }
                        setNiveis(copy)
                      }}
                      className="w-20 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={n.horas_max ?? ''}
                      placeholder="—"
                      onChange={(e) => {
                        const copy = [...niveis]
                        copy[i] = { ...copy[i], horas_max: e.target.value ? Number(e.target.value) : null }
                        setNiveis(copy)
                      }}
                      className="w-20 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={n.valor_45min}
                      onChange={(e) => {
                        const copy = [...niveis]
                        copy[i] = { ...copy[i], valor_45min: Number(e.target.value) }
                        setNiveis(copy)
                      }}
                      className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={n.valor_60min}
                      onChange={(e) => {
                        const copy = [...niveis]
                        copy[i] = { ...copy[i], valor_60min: Number(e.target.value) }
                        setNiveis(copy)
                      }}
                      className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-1">Só sessões de alunos com PT activo contam para o nível de horas.</p>
      </section>

      {/* FISCAL */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Configuração fiscal</h2>
          <button
            onClick={salvarFiscal}
            disabled={saving || !fiscal}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Guardar
          </button>
        </div>
        {fiscal && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium w-40">Taxa IRS retenção na fonte</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={fiscal.taxa_irs}
                  onChange={(e) => setFiscal({ ...fiscal, taxa_irs: Number(e.target.value) })}
                  className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">%</span>
              </div>
            </div>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1">
              <p>• IRS: o ginásio retém na fonte. Código 1519 (recibo verde).</p>
              <p>• SS: rendimento relevante = faturação do trimestre anterior ÷ 3 × 21,4%.</p>
              <p>• IVA: isento (o ginásio paga o IVA já incluído no valor recebido).</p>
            </div>
          </div>
        )}
      </section>

      {/* BÓNUS */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Bónus trimestral</h2>
          <button
            onClick={addBonus}
            className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            + Trimestre
          </button>
        </div>
        {bonus.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum bónus configurado.</p>
        ) : (
          <div className="space-y-2">
            {bonus.map((b, i) => (
              <div key={b.id || i} className="bg-white border border-gray-200 rounded-xl p-3 flex gap-3 items-end flex-wrap">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Trimestre</label>
                  <input
                    value={b.trimestre}
                    onChange={(e) => {
                      const copy = [...bonus]
                      copy[i] = { ...copy[i], trimestre: e.target.value }
                      setBonus(copy)
                    }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Horas threshold</label>
                  <input
                    type="number"
                    value={b.threshold_horas}
                    onChange={(e) => {
                      const copy = [...bonus]
                      copy[i] = { ...copy[i], threshold_horas: Number(e.target.value) }
                      setBonus(copy)
                    }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Valor bónus (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={b.valor_bonus}
                    onChange={(e) => {
                      const copy = [...bonus]
                      copy[i] = { ...copy[i], valor_bonus: Number(e.target.value) }
                      setBonus(copy)
                    }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={() => salvarBonus(b)}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Guardar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
