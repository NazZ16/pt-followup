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
  aberto: 'bg-yellow-100 text-yellow-800', fechado: 'bg-blue-100 text-blue-800',
  recibo_passado: 'bg-purple-100 text-purple-800', recebido: 'bg-green-100 text-green-800',
}
const ESTADOS_SEGUINTES: Record<EstadoBriefing, EstadoBriefing | null> = {
  aberto: 'fechado', fechado: 'recibo_passado', recibo_passado: 'recebido', recebido: null,
}
const ESTADO_ACAO: Partial<Record<EstadoBriefing, string>> = {
  aberto: 'Fechar', fechado: 'Recibo passado', recibo_passado: 'Recebido',
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

  async function avancarEstado(briefing: Briefing) {
    const seguinte = ESTADOS_SEGUINTES[briefing.estado]
    if (!seguinte) return
    // Ao fechar: recalcula totais a partir das sessões reais
    if (briefing.estado === 'aberto') {
      const sessoesDoMes = sessoes.filter(s => s.mes_briefing === briefing.id && s.estado === 'realizada')
      const bruto = sessoesDoMes.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0)
      const horas = sessoesDoMes.filter(s => s.conta_horas).reduce((acc, s) => {
        const tipo = tiposSessao.find(t => t.id === s.tipo_sessao_id)
        return acc + (tipo?.duracao_min ?? 0) / 60
      }, 0)
      const irs = bruto * taxaIrs
      const liquido = bruto - irs - ssMensal
      // Actualiza horas do bónus trimestral
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

    // Garantir briefing do mês
    const { data: brExistente } = await supabase.from('briefings').select('id').eq('id', mesBriefing).maybeSingle()
    if (!brExistente) {
      await supabase.from('briefings').insert({ id: mesBriefing, ano: d.getFullYear(), mes: d.getMonth() + 1, estado: 'aberto', total_bruto: 0, irs_retido: 0, ss_pagar: ssMensal, liquido: 0, horas_contadas: 0 })
    }

    const contaHoras = !!aluno?.convertido && tipo?.conta_para_nivel === true

    // Calcular valor: fixo para avaliações, nível para treinos
    let valorCalculado: number | null = null
    if (tipo?.categoria === 'avaliacao') {
      valorCalculado = tipo.valor_fixo ?? 0
    } else if (tipo?.categoria === 'treino' && aluno?.convertido) {
      // Horas do mês até agora (para determinar nível)
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

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Financeiro</h1>
        <div className="flex gap-2">
          <button onClick={() => setNovasSessao(true)} className="text-sm px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors">
            + Sessão
          </button>
          <button onClick={criarBriefingMesCorrente} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            + Briefing do mês
          </button>
        </div>
      </div>

      {/* FORM NOVA SESSÃO */}
      {novasSessao && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm">Registar sessão manualmente</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Aluno</label>
              <select value={`${formSessao.num_socio}|${formSessao.contacto}`}
                onChange={(e) => {
                  const [num_socio, contacto] = e.target.value.split('|')
                  setFormSessao({ ...formSessao, num_socio, contacto })
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="|">Seleccionar aluno...</option>
                {alunos.map(a => <option key={`${a.num_socio}-${a.contacto}`} value={`${a.num_socio}|${a.contacto}`}>{a.nome} ({a.num_socio})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tipo de sessão</label>
              <select value={formSessao.tipo_sessao_id}
                onChange={(e) => setFormSessao({ ...formSessao, tipo_sessao_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Seleccionar tipo...</option>
                {tiposSessao.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Data</label>
              <input type="date" value={formSessao.data_sessao}
                onChange={(e) => setFormSessao({ ...formSessao, data_sessao: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {alunoSelecionado && (
              <div className="flex items-end pb-1.5">
                <p className="text-xs text-gray-500">
                  {alunoSelecionado.convertido ? '✓ PT activo — conta para nível' : '✗ Não PT — não conta para nível'}
                </p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={registarSessao} disabled={saving} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Guardar</button>
            <button onClick={() => setNovasSessao(false)} className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">Cancelar</button>
          </div>
        </div>
      )}

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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[b.estado]}`}>{ESTADO_LABEL[b.estado]}</span>
                    </div>
                    {ESTADOS_SEGUINTES[b.estado] && (
                      <button onClick={() => avancarEstado(b)} className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors">
                        {ESTADO_ACAO[b.estado]}
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
                    <div><p className="text-xs text-gray-500">Bruto</p><p className="font-medium">{fmt(b.total_bruto)}</p></div>
                    <div><p className="text-xs text-gray-500">IRS ({(taxaIrs * 100).toFixed(1)}%)</p><p className="font-medium text-red-600">-{fmt(b.irs_retido)}</p></div>
                    <div><p className="text-xs text-gray-500">SS</p><p className="font-medium text-red-600">-{fmt(b.ss_pagar)}</p></div>
                    <div><p className="text-xs text-gray-500">Líquido</p><p className="font-semibold text-green-700">{fmt(b.liquido)}</p></div>
                  </div>
                  <button onClick={() => setMesSelecionado(mesSelecionado === b.id ? null : b.id)} className="mt-2 text-xs text-blue-600 hover:underline">
                    {mesSelecionado === b.id ? 'Ocultar' : `Ver sessões (${sessoesByMes[b.id]?.length ?? 0})`}
                  </button>
                  {mesSelecionado === b.id && (
                    <div className="mt-2 space-y-1">
                      {(sessoesByMes[b.id] || []).length === 0
                        ? <p className="text-xs text-gray-500">Sem sessões registadas.</p>
                        : (sessoesByMes[b.id] || []).map((s) => {
                          const naoRealizada = s.estado !== 'realizada'
                          return (
                            <div key={s.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${naoRealizada ? 'bg-red-50 text-gray-400 line-through' : 'bg-gray-50 text-gray-600'}`}>
                              <span className="flex-1">{s.data_sessao} · {tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id}{s.conta_horas ? ' ⏱' : ''}</span>
                              <span className="font-medium">{fmt(s.valor_calculado)}</span>
                              <button onClick={() => toggleEstadoSessao(s)} title={naoRealizada ? 'Marcar realizada' : 'Marcar não realizada'}
                                className="text-gray-400 hover:text-yellow-600 transition-colors">
                                {naoRealizada ? '↩' : '✕'}
                              </button>
                              <button onClick={() => eliminarSessao(s.id)} title="Eliminar"
                                className="text-gray-400 hover:text-red-600 transition-colors">
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
      <section>
        <h2 className="text-base font-semibold mb-3">Segurança Social trimestral</h2>
        {ss.length === 0
          ? <p className="text-sm text-gray-500">Nenhum registo de SS. Configura em <a href="/config" className="text-blue-600 hover:underline">Config</a>.</p>
          : (
            <div className="space-y-2">
              {ss.map((s) => (
                <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-3 grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-xs text-gray-500">Referência</p><p className="font-medium">T{s.trimestre_referencia} {s.ano_referencia}</p></div>
                  <div><p className="text-xs text-gray-500">Base mensal</p><p className="font-medium">{fmt(s.base_incidencia)}</p></div>
                  <div><p className="text-xs text-gray-500">SS mensal</p><p className="font-semibold text-red-600">{fmt(s.contribuicao_mensal)}</p></div>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* BÓNUS TRIMESTRAL */}
      <section>
        <h2 className="text-base font-semibold mb-3">Bónus trimestral</h2>
        {bonus.length === 0
          ? <p className="text-sm text-gray-500">Nenhum bónus registado. Configura em <a href="/config" className="text-blue-600 hover:underline">Config</a>.</p>
          : (
            <div className="space-y-2">
              {bonus.map((b) => (
                <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-4 text-sm flex-wrap">
                  <div><p className="text-xs text-gray-500">Período</p><p className="font-medium">T{b.trimestre} {b.ano}</p></div>
                  <div><p className="text-xs text-gray-500">Horas</p><p className="font-medium">{b.horas_realizadas} / {b.horas_threshold}</p></div>
                  <div><p className="text-xs text-gray-500">Bónus</p><p className="font-medium">{fmt(b.valor_bonus)}</p></div>
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
