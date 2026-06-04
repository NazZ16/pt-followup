'use client'

import { useEffect, useState } from 'react'
import { supabase, Briefing, Sessao, SsTrimestral, BonusTrimestral, EstadoBriefing } from '@/lib/supabase'

function fmt(v: number) {
  return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

const ESTADO_LABEL: Record<EstadoBriefing, string> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  recibo_passado: 'Recibo passado',
  recebido: 'Recebido',
}

const ESTADO_COLOR: Record<EstadoBriefing, string> = {
  aberto: 'bg-yellow-100 text-yellow-800',
  fechado: 'bg-blue-100 text-blue-800',
  recibo_passado: 'bg-purple-100 text-purple-800',
  recebido: 'bg-green-100 text-green-800',
}

const ESTADOS_SEGUINTES: Record<EstadoBriefing, EstadoBriefing | null> = {
  aberto: 'fechado',
  fechado: 'recibo_passado',
  recibo_passado: 'recebido',
  recebido: null,
}

const ESTADO_ACAO: Record<EstadoBriefing, string> = {
  aberto: 'Fechar briefing',
  fechado: 'Marcar recibo passado',
  recibo_passado: 'Marcar como recebido',
  recebido: '',
}

export default function FinanceiroPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [ss, setSs] = useState<SsTrimestral[]>([])
  const [bonus, setBonus] = useState<BonusTrimestral[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null)
  const [taxaIrs, setTaxaIrs] = useState(11.5)
  const [ssMensal, setSsMensal] = useState(0)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: br }, { data: se }, { data: ssd }, { data: bon }, { data: cf }, { data: ssAtual }] = await Promise.all([
      supabase.from('briefings').select('*').order('mes', { ascending: false }),
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }),
      supabase.from('ss_trimestral').select('*').order('trimestre', { ascending: false }),
      supabase.from('bonus_trimestral').select('*').order('trimestre', { ascending: false }),
      supabase.from('config_fiscal').select('*').single(),
      supabase.from('ss_trimestral').select('*').order('trimestre', { ascending: false }).limit(1).single(),
    ])
    setBriefings((br as Briefing[]) || [])
    setSessoes((se as Sessao[]) || [])
    setSs((ssd as SsTrimestral[]) || [])
    setBonus((bon as BonusTrimestral[]) || [])
    if (cf) setTaxaIrs((cf as { taxa_irs: number }).taxa_irs)
    if (ssAtual) setSsMensal((ssAtual as SsTrimestral).ss_mensal)
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
    const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
    const sessoesDoMes = sessoes.filter((s) => s.mes === mes)
    const bruto = sessoesDoMes.reduce((acc, s) => acc + s.valor_calculado, 0)
    const irs = bruto * (taxaIrs / 100)
    const net = bruto - irs - ssMensal
    await supabase.from('briefings').upsert({
      mes,
      estado: 'aberto',
      bruto,
      irs,
      ss: ssMensal,
      bonus: 0,
      liquido: net,
    }, { onConflict: 'mes' })
    load()
  }

  const sessoesByMes = sessoes.reduce<Record<string, Sessao[]>>((acc, s) => {
    if (!acc[s.mes]) acc[s.mes] = []
    acc[s.mes].push(s)
    return acc
  }, {})

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Financeiro</h1>
        <button
          onClick={criarBriefingMesCorrente}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Briefing do mês
        </button>
      </div>

      {/* BRIEFINGS */}
      <section>
        <h2 className="text-base font-semibold mb-3">Briefings mensais</h2>
        {briefings.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum briefing criado ainda.</p>
        ) : (
          <div className="space-y-2">
            {briefings.map((b) => (
              <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm">{b.mes}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[b.estado]}`}>
                      {ESTADO_LABEL[b.estado]}
                    </span>
                  </div>
                  {ESTADOS_SEGUINTES[b.estado] && (
                    <button
                      onClick={() => avancarEstado(b)}
                      className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
                    >
                      {ESTADO_ACAO[b.estado]}
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Bruto</p>
                    <p className="font-medium">{fmt(b.bruto)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">IRS ({taxaIrs}%)</p>
                    <p className="font-medium text-red-600">-{fmt(b.irs)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">SS</p>
                    <p className="font-medium text-red-600">-{fmt(b.ss)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Líquido</p>
                    <p className="font-semibold text-green-700">{fmt(b.liquido)}</p>
                  </div>
                  {b.bonus > 0 && (
                    <div>
                      <p className="text-xs text-gray-500">Bónus</p>
                      <p className="font-medium text-emerald-700">+{fmt(b.bonus)}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setMesSelecionado(mesSelecionado === b.mes ? null : b.mes)}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  {mesSelecionado === b.mes ? 'Ocultar sessões' : 'Ver sessões'}
                </button>

                {mesSelecionado === b.mes && sessoesByMes[b.mes] && (
                  <div className="mt-2 space-y-1">
                    {sessoesByMes[b.mes].map((s) => (
                      <div key={s.id} className="flex justify-between text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
                        <span>{s.data_sessao} · {s.aluno_nome} · {s.tipo_sessao}</span>
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
        {ss.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum registo de SS.</p>
        ) : (
          <div className="space-y-2">
            {ss.map((s) => (
              <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Trimestre</p>
                  <p className="font-medium">{s.trimestre}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Base mensal</p>
                  <p className="font-medium">{fmt(s.base_mensal)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">SS mensal (21,4%)</p>
                  <p className="font-semibold text-red-600">{fmt(s.ss_mensal)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* BÓNUS TRIMESTRAL */}
      <section>
        <h2 className="text-base font-semibold mb-3">Bónus trimestral</h2>
        {bonus.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum bónus registado.</p>
        ) : (
          <div className="space-y-2">
            {bonus.map((b) => (
              <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Trimestre</p>
                  <p className="font-medium">{b.trimestre}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Horas</p>
                  <p className="font-medium">{b.horas_realizadas} / {b.threshold_horas}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Bónus</p>
                  <p className="font-medium">{fmt(b.valor_bonus)}</p>
                </div>
                <div className="ml-auto">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.atingido ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {b.atingido ? 'Atingido ✓' : 'Não atingido'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
