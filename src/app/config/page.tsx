'use client'

import { useEffect, useState } from 'react'
import { supabase, NivelRemuneracao, TipoSessaoRow, ConfigFiscal, BonusTrimestral, SsTrimestral } from '@/lib/supabase'

export default function ConfigPage() {
  const [niveis, setNiveis] = useState<NivelRemuneracao[]>([])
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [fiscal, setFiscal] = useState<ConfigFiscal | null>(null)
  const [bonus, setBonus] = useState<BonusTrimestral[]>([])
  const [ss, setSs] = useState<SsTrimestral[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: n }, { data: ts }, { data: f }, { data: b }, { data: s }] = await Promise.all([
      supabase.from('niveis_remuneracao').select('*').order('nivel'),
      supabase.from('tipos_sessao').select('*').order('id'),
      supabase.from('config_fiscal').select('*').order('vigente_desde', { ascending: false }).limit(1).single(),
      supabase.from('bonus_trimestral').select('*').order('ano', { ascending: false }),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }),
    ])
    setNiveis((n as NivelRemuneracao[]) || [])
    setTiposSessao((ts as TipoSessaoRow[]) || [])
    setFiscal(f as ConfigFiscal | null)
    setBonus((b as BonusTrimestral[]) || [])
    setSs((s as SsTrimestral[]) || [])
    setLoading(false)
  }

  function ok() { setMsg('Guardado.'); setTimeout(() => setMsg(''), 3000) }

  async function salvarNiveis() {
    setSaving(true)
    for (const n of niveis) {
      await supabase.from('niveis_remuneracao').update({
        horas_min: n.horas_min, horas_max: n.horas_max,
        valor_45min: n.valor_45min, valor_60min: n.valor_60min,
      }).eq('id', n.id)
    }
    setSaving(false); ok()
  }

  async function salvarTiposSessao() {
    setSaving(true)
    for (const t of tiposSessao.filter(t => t.categoria === 'avaliacao')) {
      await supabase.from('tipos_sessao').update({ valor_fixo: t.valor_fixo }).eq('id', t.id)
    }
    setSaving(false); ok()
  }

  async function salvarFiscal() {
    if (!fiscal) return
    setSaving(true)
    await supabase.from('config_fiscal').update({ taxa_irs: fiscal.taxa_irs }).eq('id', fiscal.id)
    setSaving(false); ok()
  }

  async function salvarBonus(b: BonusTrimestral, i: number) {
    setSaving(true)
    if (b.id) {
      await supabase.from('bonus_trimestral').update({
        horas_threshold: b.horas_threshold, valor_bonus: b.valor_bonus,
      }).eq('id', b.id)
    } else {
      await supabase.from('bonus_trimestral').insert({
        ano: b.ano, trimestre: b.trimestre,
        horas_threshold: b.horas_threshold, valor_bonus: b.valor_bonus,
        horas_realizadas: 0, atingido: false,
      })
    }
    setSaving(false); ok(); load()
    void i
  }

  async function salvarSs(s: SsTrimestral) {
    setSaving(true)
    if (s.id) {
      await supabase.from('ss_trimestral').update({
        rendimento_relevante: s.rendimento_relevante,
        ano_aplicacao: s.ano_aplicacao, trimestre_aplicacao: s.trimestre_aplicacao,
      }).eq('id', s.id)
    } else {
      await supabase.from('ss_trimestral').insert({
        ano_referencia: s.ano_referencia, trimestre_referencia: s.trimestre_referencia,
        rendimento_relevante: s.rendimento_relevante,
        ano_aplicacao: s.ano_aplicacao, trimestre_aplicacao: s.trimestre_aplicacao,
      })
    }
    setSaving(false); ok(); load()
  }

  function addBonus() {
    const hoje = new Date()
    setBonus([...bonus, {
      id: 0, ano: hoje.getFullYear(), trimestre: Math.ceil((hoje.getMonth() + 1) / 3),
      horas_threshold: 0, valor_bonus: 0, horas_realizadas: 0,
      atingido: false, recebido: false, data_recebimento: null,
    }])
  }

  function addSs() {
    const hoje = new Date()
    const trim = Math.ceil((hoje.getMonth() + 1) / 3)
    const proxTrim = trim === 4 ? 1 : trim + 1
    const proxAno = trim === 4 ? hoje.getFullYear() + 1 : hoje.getFullYear()
    setSs([{
      id: 0, ano_referencia: hoje.getFullYear(), trimestre_referencia: trim,
      rendimento_relevante: 0, base_incidencia: 0, contribuicao_mensal: 0,
      ano_aplicacao: proxAno, trimestre_aplicacao: proxTrim,
    }, ...ss])
  }

  const avaliacao = tiposSessao.filter(t => t.categoria === 'avaliacao')

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Configurações</h1>
      {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-2">{msg}</div>}

      {/* VALORES DAS AVALIAÇÕES */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Valor das avaliações</h2>
          <button onClick={salvarTiposSessao} disabled={saving}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Guardar
          </button>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Valor (€)</th>
              </tr>
            </thead>
            <tbody>
              {avaliacao.map((t, i) => (
                <tr key={t.id} className={i < avaliacao.length - 1 ? 'border-b border-gray-100' : ''}>
                  <td className="px-4 py-2 font-medium">{t.nome}</td>
                  <td className="px-4 py-2">
                    <input type="number" step="0.01" value={t.valor_fixo ?? ''}
                      onChange={(e) => {
                        const copy = [...tiposSessao]
                        const idx = copy.findIndex(x => x.id === t.id)
                        copy[idx] = { ...copy[idx], valor_fixo: e.target.value ? Number(e.target.value) : null }
                        setTiposSessao(copy)
                      }}
                      className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* NÍVEIS DE REMUNERAÇÃO */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Níveis de remuneração (treinos)</h2>
          <button onClick={salvarNiveis} disabled={saving}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
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
                    <input type="number" value={n.horas_min}
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], horas_min: Number(e.target.value) }; setNiveis(c) }}
                      className="w-20 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={n.horas_max ?? ''} placeholder="—"
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], horas_max: e.target.value ? Number(e.target.value) : null }; setNiveis(c) }}
                      className="w-20 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" step="0.01" value={n.valor_45min}
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], valor_45min: Number(e.target.value) }; setNiveis(c) }}
                      className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" step="0.01" value={n.valor_60min}
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], valor_60min: Number(e.target.value) }; setNiveis(c) }}
                      className="w-24 border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-1">Só sessões de alunos com PT activo contam para o nível.</p>
      </section>

      {/* FISCAL */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Configuração fiscal</h2>
          <button onClick={salvarFiscal} disabled={saving || !fiscal}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Guardar
          </button>
        </div>
        {fiscal && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium w-48">Taxa IRS retenção na fonte</label>
              <input type="number" step="0.001" min="0" max="1"
                value={fiscal.taxa_irs}
                onChange={(e) => setFiscal({ ...fiscal, taxa_irs: Number(e.target.value) })}
                className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-sm text-gray-600">= {(fiscal.taxa_irs * 100).toFixed(1)}%</span>
            </div>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1">
              <p>• IRS: o ginásio retém na fonte. Código 1519 (recibo verde).</p>
              <p>• SS: rendimento relevante = faturação do trimestre anterior ÷ 3 × 21,4%.</p>
              <p>• IVA: isento — o ginásio paga o IVA já incluído no valor recebido.</p>
            </div>
          </div>
        )}
      </section>

      {/* SS TRIMESTRAL */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Segurança Social — registos</h2>
          <button onClick={addSs}
            className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            + Trimestre
          </button>
        </div>
        {ss.length === 0
          ? <p className="text-sm text-gray-500">Nenhum registo de SS. Adiciona no fim de cada trimestre.</p>
          : (
            <div className="space-y-2">
              {ss.map((s, i) => (
                <div key={s.id || i} className="bg-white border border-gray-200 rounded-xl p-3 flex gap-3 items-end flex-wrap">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Ref. (T/Ano)</label>
                    <div className="flex gap-1">
                      <input type="number" min="1" max="4" value={s.trimestre_referencia}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], trimestre_referencia: Number(e.target.value) }; setSs(c) }}
                        className="w-12 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="number" value={s.ano_referencia}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], ano_referencia: Number(e.target.value) }; setSs(c) }}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Faturação trimestre (€)</label>
                    <input type="number" step="0.01" value={s.rendimento_relevante}
                      onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], rendimento_relevante: Number(e.target.value) }; setSs(c) }}
                      className="w-32 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Aplica em (T/Ano)</label>
                    <div className="flex gap-1">
                      <input type="number" min="1" max="4" value={s.trimestre_aplicacao}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], trimestre_aplicacao: Number(e.target.value) }; setSs(c) }}
                        className="w-12 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="number" value={s.ano_aplicacao}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], ano_aplicacao: Number(e.target.value) }; setSs(c) }}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  {s.contribuicao_mensal > 0 && (
                    <div className="text-sm">
                      <p className="text-xs text-gray-500">SS mensal</p>
                      <p className="font-semibold text-red-600">{s.contribuicao_mensal.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}</p>
                    </div>
                  )}
                  <button onClick={() => salvarSs(s)} disabled={saving}
                    className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    Guardar
                  </button>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* BÓNUS */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Bónus trimestral</h2>
          <button onClick={addBonus}
            className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            + Trimestre
          </button>
        </div>
        {bonus.length === 0
          ? <p className="text-sm text-gray-500">Nenhum bónus configurado.</p>
          : (
            <div className="space-y-2">
              {bonus.map((b, i) => (
                <div key={b.id || i} className="bg-white border border-gray-200 rounded-xl p-3 flex gap-3 items-end flex-wrap">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">T / Ano</label>
                    <div className="flex gap-1">
                      <input type="number" min="1" max="4" value={b.trimestre}
                        onChange={(e) => { const c = [...bonus]; c[i] = { ...c[i], trimestre: Number(e.target.value) }; setBonus(c) }}
                        className="w-12 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="number" value={b.ano}
                        onChange={(e) => { const c = [...bonus]; c[i] = { ...c[i], ano: Number(e.target.value) }; setBonus(c) }}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Horas threshold</label>
                    <input type="number" value={b.horas_threshold}
                      onChange={(e) => { const c = [...bonus]; c[i] = { ...c[i], horas_threshold: Number(e.target.value) }; setBonus(c) }}
                      className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Valor bónus (€)</label>
                    <input type="number" step="0.01" value={b.valor_bonus}
                      onChange={(e) => { const c = [...bonus]; c[i] = { ...c[i], valor_bonus: Number(e.target.value) }; setBonus(c) }}
                      className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <button onClick={() => salvarBonus(b, i)} disabled={saving}
                    className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
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
