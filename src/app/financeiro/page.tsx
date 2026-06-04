'use client'

import { useEffect, useState } from 'react'
import { supabase, Briefing, Sessao, SsTrimestral, BonusTrimestral, EstadoBriefing } from '@/lib/supabase'

function fmt(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

const ESTADO_LABEL: Record<EstadoBriefing, string> = {
  aberto: 'Aberto', fechado: 'Fechado', recibo_passado: 'Recibo passado', recebido: 'Recebido',
}
const ESTADO_COLOR: Record<EstadoBriefing, string> = {
  aberto: 'bg-yellow-100 text-yellow-800',
  fechado: 'bg-blue-100 text-blue-800',
  recibo_passado: 'bg-purple-100 text-purple-800',
  recebido: 'bg-green-100 text-green-800',
}
const ESTADOS_SEGUINTES: Record<EstadoBriefing, EstadoBriefing | null> = {
  aberto: 'fechado', fechado: 'recibo_passado', recibo_passado: 'recebido', recebido: null,
}
const ESTADO_ACAO: Partial<Record<EstadoBriefing, string>> = {
  aberto: 'Fechar briefing', fechado: 'Marcar recibo passado', recibo_passado: 'Marcar como recebido',
}

export default function FinanceiroPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [ss, setSs] = useState<SsTrimestral[]>([])
  const [bonus, setBonus] = useState<BonusTrimestral[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null)
  const [taxaIrs, setTaxaIrs] = useState(0.115)
  const [ssMensal, setSsMensal] = useState(0)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: br }, { data: se }, { data: ssd }, { data: bon }, { data: cf }, { data: ssAtual }] = await Promise.all([
      supabase.from('briefings').select('*').order('id', { ascending: false }),
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }),
      supabase.from('bonus_trimestral').select('*').order('ano', { ascending: false }),
      supabase.from('config_fiscal').select('*').order('vigente_desde', { ascending: false }).limit(1).single(),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }).limit(1).maybeSingle(),
    ])
    setBriefings((br as Briefing[]) || [])
    setSessoes((se as Sessao[]) || [])
    setSs((ssd as SsTrimestral[]) || [])
    setBonus((bon as BonusTrimestral[]) || [])
    if (cf) setTaxaIrs((cf as { taxa_irs: number }).taxa_irs)
    if (ssAtual) setSsMensal((ssAtual as SsTrimestral).contribuicao_mensal)
    setLoading(false)
  }

  async function avancarEstado(briefing: Briefing) {
    const seguinte = ESTADOS_SEGUINTES[briefing.estado]
    if (!seguinte) return
    await supabase.from('briefings').update({ estado: seguinte }).eq('id', briefing.id)
    load()
  }

  async function criarBriefingMesCorrente() {
    const hoje = new Date()
    const ano = hoje.getFullYear()
    const mes = hoje.getMonth() + 1
    const id = `${ano}-${String(mes).padStart(2, '0')}`
    const sessoesDoMes = sessoes.filter((s) => s.mes_briefing === id)
    const bruto = sessoesDoMes.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0)
    const irs = bruto * taxaIrs
    const liquido = bruto - irs - ssMensal
    await supabase.from('briefings').upsert({
      id, ano, mes, estado: 'aberto',
      total_bruto: bruto, irs_retido: irs, ss_pagar: ssMensal, liquido,
      horas_contadas: 0,
    }, { onConflict: 'id' })
    load()
  }

  const sessoesByMes = sessoes.reduce<Record<string, Sessao[]>>((acc, s) => {
    if (!s.mes_briefing) return acc
    if (!acc[s.mes_briefing]) acc[s.mes_briefing] = []
    acc[s.mes_briefing].push(s)
    return acc
  }, {})

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Financeiro</h1>
        <button onClick={criarBriefingMesCorrente}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          + Briefing do mês
        </button>
      </div>

      {/* BRIEFINGS */}
      <section>
        <h2 className="text-base font-semibold mb-3">Briefings mensais</h2>
        {briefings.length === 0
          ? <p className="text-sm text-gray-500">Nenhum briefing criado ainda.</p>
          : (
            <div className="space-y-2">
              {briefings.map((b) => (
                <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">{b.id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[b.estado]}`}>
                        {ESTADO_LABEL[b.estado]}
                      </span>
                    </div>
                    {ESTADOS_SEGUINTES[b.estado] && (
                      <button onClick={() => avancarEstado(b)}
                        className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors">
                        {ESTADO_ACAO[b.estado]}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Bruto</p>
                      <p className="font-medium">{fmt(b.total_bruto)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">IRS ({(taxaIrs * 100).toFixed(1)}%)</p>
                      <p className="font-medium text-red-600">-{fmt(b.irs_retido)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">SS</p>
                      <p className="font-medium text-red-600">-{fmt(b.ss_pagar)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Líquido</p>
                      <p className="font-semibold text-green-700">{fmt(b.liquido)}</p>
                    </div>
                  </div>
                  <button onClick={() => setMesSelecionado(mesSelecionado === b.id ? null : b.id)}
                    className="mt-2 text-xs text-blue-600 hover:underline">
                    {mesSelecionado === b.id ? 'Ocultar sessões' : 'Ver sessões'}
                  </button>
                  {mesSelecionado === b.id && sessoesByMes[b.id] && (
                    <div className="mt-2 space-y-1">
                      {sessoesByMes[b.id].map((s) => (
                        <div key={s.id} className="flex justify-between text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
                          <span>{s.data_sessao} · {s.tipo_sessao_id}</span>
                          <span className="font-medium">{fmt(s.valor_calculado)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </section>

      {/* SS TRIMESTRAL */}
      <section>
        <h2 className="text-base font-semibold mb-3">Segurança Social trimestral</h2>
        {ss.length === 0
          ? <p className="text-sm text-gray-500">Nenhum registo de SS.</p>
          : (
            <div className="space-y-2">
              {ss.map((s) => (
                <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Referência</p>
                    <p className="font-medium">T{s.trimestre_referencia} {s.ano_referencia}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Base mensal</p>
                    <p className="font-medium">{fmt(s.base_incidencia)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">SS mensal (21,4%)</p>
                    <p className="font-semibold text-red-600">{fmt(s.contribuicao_mensal)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* BÓNUS TRIMESTRAL */}
      <section>
        <h2 className="text-base font-semibold mb-3">Bónus trimestral</h2>
        {bonus.length === 0
          ? <p className="text-sm text-gray-500">Nenhum bónus registado.</p>
          : (
            <div className="space-y-2">
              {bonus.map((b) => (
                <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-4 text-sm flex-wrap">
                  <div>
                    <p className="text-xs text-gray-500">Período</p>
                    <p className="font-medium">T{b.trimestre} {b.ano}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Horas</p>
                    <p className="font-medium">{b.horas_realizadas} / {b.horas_threshold}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Bónus</p>
                    <p className="font-medium">{fmt(b.valor_bonus)}</p>
                  </div>
                  <div className="ml-auto flex gap-2 items-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.atingido ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {b.atingido ? 'Atingido ✓' : 'Não atingido'}
                    </span>
                    {b.atingido && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.recebido ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-700'}`}>
                        {b.recebido ? 'Recebido' : 'Por receber'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
