'use client'

import { useEffect, useState } from 'react'
import { supabase, Briefing, Sessao, SsTrimestral, BonusTrimestral, EstadoBriefing, Aluno, TipoSessaoRow } from '@/lib/supabase'

function fmt(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

const ESTADO_LABEL: Record<EstadoBriefing, string> = {
  aberto: 'Aberto', fechado: 'Fechado', recibo_passado: 'Recibo passado', recebido: 'Recebido',
}
const ESTADO_COLOR: Record<EstadoBriefing, string> = {
  aberto: 'bg-amber-100 text-amber-700',
  fechado: 'bg-blue-100 text-blue-700',
  recibo_passado: 'bg-purple-100 text-purple-700',
  recebido: 'bg-emerald-100 text-emerald-700',
}
const ESTADOS_SEGUINTES: Record<EstadoBriefing, EstadoBriefing | null> = {
  aberto: 'fechado', fechado: 'recibo_passado', recibo_passado: 'recebido', recebido: null,
}
const ESTADOS_ANTERIORES: Partial<Record<EstadoBriefing, EstadoBriefing>> = {
  fechado: 'aberto', recibo_passado: 'fechado', recebido: 'recibo_passado',
}
const ESTADO_ACAO: Partial<Record<EstadoBriefing, string>> = {
  aberto: 'Fechar mês', fechado: 'Recibo passado', recibo_passado: 'Marcar recebido',
}
const ESTADO_ACAO_VOLTAR: Partial<Record<EstadoBriefing, string>> = {
  fechado: 'Reabrir', recibo_passado: 'Voltar a fechado', recebido: 'Voltar a recibo passado',
}

interface FormSessao {
  num_socio: string
  contacto: string
  tipo_sessao_id: string
  data_sessao: string
}

export default function FinanceiroPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [ss, setSs] = useState<SsTrimestral[]>([])
  const [bonus, setBonus] = useState<BonusTrimestral[]>([])
  const [alunos, setAlunos] = useState<Aluno[]>([])
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null)
  const [taxaIrs, setTaxaIrs] = useState(0.115)
  const [ssMensal, setSsMensal] = useState(0)
  const [novasSessao, setNovasSessao] = useState(false)
  const [formSessao, setFormSessao] = useState<FormSessao>({ num_socio: '', contacto: '', tipo_sessao_id: '', data_sessao: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: br }, { data: se }, { data: ssd }, { data: bon }, { data: cf }, { data: ssAtual }, { data: al }, { data: ts }] = await Promise.all([
      supabase.from('briefings').select('*').order('id', { ascending: false }),
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }),
      supabase.from('bonus_trimestral').select('*').order('ano', { ascending: false }),
      supabase.from('config_fiscal').select('*').order('vigente_desde', { ascending: false }).limit(1).single(),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('alunos').select('*').order('nome'),
      supabase.from('tipos_sessao').select('*').order('id'),
    ])
    setBriefings((br as Briefing[]) || [])
    setSessoes((se as Sessao[]) || [])
    setSs((ssd as SsTrimestral[]) || [])
    setBonus((bon as BonusTrimestral[]) || [])
    setAlunos((al as Aluno[]) || [])
    setTiposSessao((ts as TipoSessaoRow[]) || [])
    if (cf) setTaxaIrs((cf as { taxa_irs: number }).taxa_irs)
    if (ssAtual) setSsMensal((ssAtual as SsTrimestral).contribuicao_mensal)
    setLoading(false)
  }

  async function recuarEstado(briefing: Briefing) {
    const anterior = ESTADOS_ANTERIORES[briefing.estado]
    if (!anterior) return
    await supabase.from('briefings').update({ estado: anterior }).eq('id', briefing.id)
    load()
  }

  async function avancarEstado(briefing: Briefing) {
    const seguinte = ESTADOS_SEGUINTES[briefing.estado]
    if (!seguinte) return
    if (briefing.estado === 'aberto') {
      const sessoesDoMes = sessoes.filter(s => s.mes_briefing === briefing.id && s.estado === 'realizada')
      const bruto = sessoesDoMes.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0)
      const horas = sessoesDoMes.filter(s => s.conta_horas).reduce((acc, s) => {
        const tipo = tiposSessao.find(t => t.id === s.tipo_sessao_id)
        return acc + (tipo?.duracao_min ?? 0) / 60
      }, 0)
      const irs = bruto * taxaIrs
      const liquido = bruto - irs - ssMensal
      const trim = Math.ceil(briefing.mes / 3)
      const bonusTrim = bonus.find(b => b.ano === briefing.ano && b.trimestre === trim)
      if (bonusTrim) {
        const sessTrimestre = sessoes.filter(s => {
          if (!s.mes_briefing || !s.conta_horas || s.estado !== 'realizada') return false
          const [a, m] = s.mes_briefing.split('-').map(Number)
          return a === briefing.ano && Math.ceil(m / 3) === trim
        })
        const horasTrim = sessTrimestre.reduce((acc, s) => {
          const tipo = tiposSessao.find(t => t.id === s.tipo_sessao_id)
          return acc + (tipo?.duracao_min ?? 0) / 60
        }, 0)
        await supabase.from('bonus_trimestral').update({
          horas_realizadas: Math.round(horasTrim * 100) / 100,
          atingido: horasTrim >= bonusTrim.horas_threshold,
        }).eq('id', bonusTrim.id)
      }
      await supabase.from('briefings').update({
        estado: seguinte, total_bruto: bruto, irs_retido: irs,
        ss_pagar: ssMensal, liquido, horas_contadas: Math.round(horas * 100) / 100,
        data_fecho: new Date().toISOString().slice(0, 10),
      }).eq('id', briefing.id)
    } else {
      await supabase.from('briefings').update({ estado: seguinte }).eq('id', briefing.id)
    }
    load()
  }

  async function eliminarSessao(id: string) {
    await supabase.from('sessoes').delete().eq('id', id)
    load()
  }

  async function toggleEstadoSessao(sessao: Sessao) {
    const novoEstado = sessao.estado === 'realizada' ? 'nao_realizada' : 'realizada'
    await supabase.from('sessoes').update({ estado: novoEstado }).eq('id', sessao.id)
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
    await supabase.from('briefings').upsert({ id, ano, mes, estado: 'aberto', total_bruto: bruto, irs_retido: irs, ss_pagar: ssMensal, liquido, horas_contadas: 0 }, { onConflict: 'id' })
    load()
  }

  async function registarSessao() {
    if (!formSessao.num_socio || !formSessao.tipo_sessao_id || !formSessao.data_sessao) return
    setSaving(true)
    const aluno = alunos.find(a => a.num_socio === formSessao.num_socio && a.contacto === formSessao.contacto)
    const tipo = tiposSessao.find(t => t.id === formSessao.tipo_sessao_id)
    const d = new Date(formSessao.data_sessao + 'T12:00:00')
    const mesBriefing = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const { data: brExistente } = await supabase.from('briefings').select('id').eq('id', mesBriefing).maybeSingle()
    if (!brExistente) {
      await supabase.from('briefings').insert({ id: mesBriefing, ano: d.getFullYear(), mes: d.getMonth() + 1, estado: 'aberto', total_bruto: 0, irs_retido: 0, ss_pagar: ssMensal, liquido: 0, horas_contadas: 0 })
    }

    const contaHoras = !!aluno?.convertido && tipo?.conta_para_nivel === true

    let valorCalculado: number | null = null
    if (tipo?.categoria === 'avaliacao') {
      valorCalculado = tipo.valor_fixo ?? 0
    } else if (tipo?.categoria === 'treino' && aluno?.convertido) {
      const { data: niveis } = await supabase.from('niveis_remuneracao').select('*').order('horas_min')
      const sessoesDoMes = sessoes.filter(s => s.mes_briefing === mesBriefing && s.conta_horas && s.estado === 'realizada')
      const horasMes = sessoesDoMes.reduce((acc, s) => {
        const t = tiposSessao.find(x => x.id === s.tipo_sessao_id)
        return acc + (t?.duracao_min ?? 0) / 60
      }, 0) + (tipo.duracao_min ?? 0) / 60
      const nivel = ((niveis || []) as { horas_min: number; horas_max: number | null; valor_45min: number; valor_60min: number }[])
        .filter(n => horasMes >= n.horas_min && (n.horas_max == null || horasMes < n.horas_max))
        .pop()
      if (nivel) valorCalculado = tipo.duracao_min === 45 ? nivel.valor_45min : nivel.valor_60min
    }

    await supabase.from('sessoes').insert({
      num_socio: formSessao.num_socio,
      contacto: formSessao.contacto,
      tipo_sessao_id: formSessao.tipo_sessao_id,
      data_sessao: formSessao.data_sessao,
      estado: 'realizada',
      mes_briefing: mesBriefing,
      incluida_briefing: false,
      conta_horas: contaHoras,
      valor_calculado: valorCalculado,
    })
    setNovasSessao(false)
    setSaving(false)
    load()
  }

  const sessoesByMes = sessoes.reduce<Record<string, Sessao[]>>((acc, s) => {
    if (!s.mes_briefing) return acc
    if (!acc[s.mes_briefing]) acc[s.mes_briefing] = []
    acc[s.mes_briefing].push(s)
    return acc
  }, {})

  const alunoSelecionado = alunos.find(a => a.num_socio === formSessao.num_socio && a.contacto === formSessao.contacto)

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-gray-400 text-sm">A carregar...</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>
        <div className="flex gap-2">
          <button onClick={() => setNovasSessao(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 transition-colors shadow-sm">
            + Sessão
          </button>
          <button onClick={criarBriefingMesCorrente}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm">
            + Briefing
          </button>
        </div>
      </div>

      {/* FORM NOVA SESSÃO */}
      {novasSessao && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3">
          <h2 className="font-semibold">Registar sessão</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Aluno</label>
              <select value={`${formSessao.num_socio}|${formSessao.contacto}`}
                onChange={(e) => {
                  const [num_socio, contacto] = e.target.value.split('|')
                  setFormSessao({ ...formSessao, num_socio, contacto })
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="|">Seleccionar aluno...</option>
                {alunos.map(a => <option key={`${a.num_socio}-${a.contacto}`} value={`${a.num_socio}|${a.contacto}`}>{a.nome} ({a.num_socio})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Tipo de sessão</label>
              <select value={formSessao.tipo_sessao_id}
                onChange={(e) => setFormSessao({ ...formSessao, tipo_sessao_id: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Seleccionar...</option>
                {tiposSessao.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Data</label>
              <input type="date" value={formSessao.data_sessao}
                onChange={(e) => setFormSessao({ ...formSessao, data_sessao: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {alunoSelecionado && (
              <p className="col-span-2 text-sm text-gray-500">
                {alunoSelecionado.convertido ? '✓ PT activo — conta para nível' : '✗ Não PT — não conta para nível'}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={registarSessao} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Guardar
            </button>
            <button onClick={() => setNovasSessao(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* BRIEFINGS */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base text-gray-800">Briefings mensais</h2>
        {briefings.length === 0
          ? <p className="text-sm text-gray-400 py-2">Nenhum briefing criado ainda.</p>
          : (
            <div className="space-y-3">
              {briefings.map((b) => (
                <div key={b.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-lg text-gray-900">{b.id}</span>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ESTADO_COLOR[b.estado]}`}>{ESTADO_LABEL[b.estado]}</span>
                      </div>
                      <div className="flex gap-2">
                        {ESTADOS_ANTERIORES[b.estado] && (
                          <button onClick={() => recuarEstado(b)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                            ↩ {ESTADO_ACAO_VOLTAR[b.estado]}
                          </button>
                        )}
                        {ESTADOS_SEGUINTES[b.estado] && (
                          <button onClick={() => avancarEstado(b)}
                            className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors">
                            {ESTADO_ACAO[b.estado]}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-3">
                      <FinRow label="Bruto" value={fmt(b.total_bruto)} />
                      <FinRow label={`IRS ${(taxaIrs * 100).toFixed(1)}%`} value={`-${fmt(b.irs_retido)}`} negative />
                      <FinRow label="SS" value={`-${fmt(b.ss_pagar)}`} negative />
                      <FinRow label="Líquido" value={fmt(b.liquido)} highlight />
                    </div>

                    <button onClick={() => setMesSelecionado(mesSelecionado === b.id ? null : b.id)}
                      className="mt-3 text-sm text-blue-600 font-medium hover:underline">
                      {mesSelecionado === b.id ? 'Ocultar sessões' : `Ver sessões (${sessoesByMes[b.id]?.length ?? 0})`}
                    </button>
                  </div>

                  {mesSelecionado === b.id && (
                    <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-1.5">
                      {(sessoesByMes[b.id] || []).length === 0
                        ? <p className="text-sm text-gray-400 py-1">Sem sessões registadas.</p>
                        : (sessoesByMes[b.id] || []).map((s) => {
                          const naoRealizada = s.estado !== 'realizada'
                          return (
                            <div key={s.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${naoRealizada ? 'bg-red-50 text-gray-400' : 'bg-white border border-gray-100 text-gray-700'}`}>
                              <span className={`flex-1 text-sm ${naoRealizada ? 'line-through' : ''}`}>
                                {s.data_sessao} · {tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id}
                                {s.conta_horas && <span className="ml-1 text-xs text-blue-600 font-medium">⏱</span>}
                              </span>
                              <span className="font-semibold text-sm">{fmt(s.valor_calculado)}</span>
                              <button onClick={() => toggleEstadoSessao(s)} title={naoRealizada ? 'Marcar realizada' : 'Marcar não realizada'}
                                className="text-gray-400 hover:text-amber-600 transition-colors text-lg leading-none">
                                {naoRealizada ? '↩' : '✕'}
                              </button>
                              <button onClick={() => eliminarSessao(s.id)} title="Eliminar"
                                className="text-gray-400 hover:text-red-500 transition-colors">
                                🗑
                              </button>
                            </div>
                          )
                        })
                      }
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </section>

      {/* SS TRIMESTRAL */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base text-gray-800">Segurança Social trimestral</h2>
        {ss.length === 0
          ? <p className="text-sm text-gray-400 py-2">Sem registos. Configura em <a href="/config" className="text-blue-600 hover:underline">Config</a>.</p>
          : (
            <div className="space-y-2">
              {ss.map((s) => (
                <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 grid grid-cols-3 gap-3">
                  <FinRow label="Referência" value={`T${s.trimestre_referencia} ${s.ano_referencia}`} />
                  <FinRow label="Base mensal" value={fmt(s.base_incidencia)} />
                  <FinRow label="SS mensal" value={fmt(s.contribuicao_mensal)} negative />
                </div>
              ))}
            </div>
          )}
      </section>

      {/* BÓNUS TRIMESTRAL */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base text-gray-800">Bónus trimestral</h2>
        {bonus.length === 0
          ? <p className="text-sm text-gray-400 py-2">Sem registos. Configura em <a href="/config" className="text-blue-600 hover:underline">Config</a>.</p>
          : (
            <div className="space-y-2">
              {bonus.map((b) => (
                <div key={b.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-lg text-gray-900">T{b.trimestre} {b.ano}</span>
                    <div className="flex gap-2">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${b.atingido ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {b.atingido ? 'Atingido ✓' : 'Não atingido'}
                      </span>
                      {b.atingido && (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${b.recebido ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {b.recebido ? 'Recebido' : 'Por receber'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FinRow label="Horas" value={`${b.horas_realizadas} / ${b.horas_threshold}h`} />
                    <FinRow label="Valor bónus" value={fmt(b.valor_bonus)} highlight={b.atingido} />
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}

function FinRow({ label, value, highlight, negative }: { label: string; value: string; highlight?: boolean; negative?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`font-semibold mt-0.5 ${highlight ? 'text-emerald-600 text-lg' : negative ? 'text-red-500' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
