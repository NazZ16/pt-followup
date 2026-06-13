'use client'

import { useEffect, useState } from 'react'
import { supabase, TarefaHoje, MesCorrente, Aluno, Sessao, TipoSessaoRow, NivelRemuneracao, ConfigFiscal, SsTrimestral, ServicoPT } from '@/lib/supabase'
import { gerarMensagem, gerarMensagemLembrete, gerarMensagemPlanoPT, gerarLinkWhatsApp } from '@/lib/whatsapp'
import { marcarTarefaViaScript, appsScriptConfigurado } from '@/lib/appsscript'

const URGENCIA_COLOR: Record<string, string> = {
  atrasada: 'bg-red-100 text-red-700', hoje: 'bg-amber-100 text-amber-700',
  esta_semana: 'bg-blue-100 text-blue-700', futura: 'bg-gray-100 text-gray-600',
}
const URGENCIA_LABEL: Record<string, string> = {
  atrasada: 'Atrasada', hoje: 'Hoje', esta_semana: 'Esta semana', futura: 'Futura',
}
const MARCO_LABEL: Record<string, string> = { '7d': 'D+7', '30d': 'D+30', '60d': 'D+60', '120d': 'D+120' }

function fmt(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

export default function BriefingPage() {
  const [tarefas, setTarefas] = useState<TarefaHoje[]>([])
  const [mes, setMes] = useState<MesCorrente | null>(null)
  const [semPlano, setSemPlano] = useState<Aluno[]>([])
  const [semPlanoApp, setSemPlanoApp] = useState<Aluno[]>([])
  const [briefingAberto, setBriefingAberto] = useState(false)
  const [sessoesSemana, setSessoesSemana] = useState<(Sessao & { nome?: string })[]>([])
  const [avaliacoesAmanha, setAvaliacoesAmanha] = useState<(Sessao & { nome?: string })[]>([])
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [stats, setStats] = useState({ totalAlunos: 0, convertidos: 0, semPlanoTotal: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const hoje = new Date().toISOString().slice(0, 10)
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const fimSemana = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    const mesBriefing = hoje.slice(0, 7)
    const [{ data: t }, { data: a }, { data: b }, { data: sa }, { data: sw }, { data: ts }, { data: allAlunos }, { data: alunosPT }, { data: svs }, { data: nvs }, { data: fc }, { data: ssData }, { data: sesMes }] = await Promise.all([
      supabase.from('v_tarefas_hoje').select('*').order('data_prevista'),
      supabase.from('alunos').select('*').is('plano_confirmado_em', null).lt('ultima_avaliacao', cutoff).eq('estado', 'ativo'),
      supabase.from('briefings').select('*').eq('estado', 'aberto'),
      supabase.from('sessoes').select('*').eq('data_sessao', amanha),
      supabase.from('sessoes').select('*').gte('data_sessao', hoje).lte('data_sessao', fimSemana).order('data_sessao').order('hora_inicio'),
      supabase.from('tipos_sessao').select('*'),
      supabase.from('alunos').select('*'),
      supabase.from('alunos').select('*').eq('convertido', true).eq('estado', 'ativo'),
      supabase.from('servicos_pt').select('*'),
      supabase.from('niveis_remuneracao').select('*').order('horas_min'),
      supabase.from('config_fiscal').select('*').order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('ss_trimestral').select('*').order('ano_aplicacao', { ascending: false }).order('trimestre_aplicacao', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('sessoes').select('valor_calculado').eq('mes_briefing', mesBriefing).eq('estado', 'realizada'),
    ])
    setTarefas((t as TarefaHoje[]) || [])
    setSemPlano((a as Aluno[]) || [])
    setBriefingAberto(!!b?.length && new Date().getDate() > 5)
    const aa = (allAlunos as (Aluno & { convertido: boolean; plano_confirmado_em: string | null; estado: string })[]) || []
    const nomePorSocio = (ns: string | null, c: string | null) =>
      ns ? (aa.find(x => x.num_socio === ns && x.contacto === c) as Aluno | undefined)?.nome : undefined
    setSessoesSemana(((sw as Sessao[]) || []).map(s => ({ ...s, nome: nomePorSocio(s.num_socio, s.contacto) })))
    const tsData = (ts as TipoSessaoRow[]) || []
    setTiposSessao(tsData)
    const NATACAO = new Set(['n1','n2','n3','n4','n5','n6','n1f','n2f','n3f','n4f','n5f','n6f'])
    const avalIds = new Set(tsData.filter(x => x.categoria === 'avaliacao').map(x => x.id))
    setAvaliacoesAmanha(
      ((sa as Sessao[]) || [])
        .filter(s => avalIds.has(s.tipo_sessao_id) && !NATACAO.has(s.tipo_sessao_id))
        .map(s => ({ ...s, nome: nomePorSocio(s.num_socio, s.contacto) }))
    )
    setStats({
      totalAlunos: aa.filter(x => x.estado === 'ativo').length,
      convertidos: aa.filter(x => x.convertido && x.estado === 'ativo').length,
      semPlanoTotal: aa.filter(x => !x.plano_confirmado_em && x.estado === 'ativo').length,
    })
    setSemPlanoApp(aa.filter(x => !x.plano_confirmado_em && x.estado === 'ativo' && (x.convertido || x.tipo === 'rep' || x.tipo === 'oi')))

    // Calcular mês em curso
    const aptivos = (alunosPT as Aluno[]) || []
    const servicosList = (svs as ServicoPT[]) || []
    const niveisList = (nvs as NivelRemuneracao[]) || []
    const taxaIrs = (fc as ConfigFiscal | null)?.taxa_irs ?? 0.1
    const ssMensal = (ssData as SsTrimestral | null)?.contribuicao_mensal ?? 0

    // Horas e nível baseados nos planos vendidos (igual ao financeiro)
    const totalHoras = Math.round(aptivos.reduce((sum, al) => {
      const sv = servicosList.find(s => s.nome === al.plano_pt)
      if (sv) {
        const dur = (sv.duracao_min ?? 60) / 60
        const sessoes = sv.sessoes_semana || 1
        const mult = sv.tipo === 'semanal' ? 4.33 : 1
        return sum + sessoes * mult * dur
      }
      return sum + (al.horas_pt_mensais || 0)
    }, 0) * 100) / 100
    const nivelAtual = [...niveisList].reverse().find(n =>
      totalHoras >= n.horas_min && (n.horas_max == null || totalHoras <= n.horas_max)
    ) ?? null

    // Bruto real = soma do valor_calculado das sessões realizadas este mês (igual ao financeiro)
    const bruto = Math.round(((sesMes as { valor_calculado: number | null }[]) || [])
      .reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0) * 100) / 100
    const irsRetido = Math.round(bruto * taxaIrs * 100) / 100
    const liquido = Math.round((bruto - irsRetido - ssMensal) * 100) / 100

    setMes(aptivos.length === 0 ? null : {
      total_sessoes: aptivos.length,
      horas_nivel: totalHoras,
      bruto_acumulado: bruto,
      nivel_atual: nivelAtual?.nivel ?? null,
      nivel_horas_min: nivelAtual?.horas_min ?? null,
      nivel_horas_max: nivelAtual?.horas_max ?? null,
      taxa_irs: taxaIrs,
      irs_estimado: irsRetido,
      ss_mensal: ssMensal,
      liquido_estimado: liquido,
    })

    setLoading(false)
  }

  async function toggleSessao(sessao: Sessao & { nome?: string }) {
    const novoEstado = sessao.estado === 'realizada' ? 'nao_realizada' : 'realizada'
    await supabase.from('sessoes').update({ estado: novoEstado }).eq('id', sessao.id)
    loadAll()
  }

  async function marcarFeita(tarefa: TarefaHoje) {
    if (appsScriptConfigurado()) {
      await marcarTarefaViaScript({ tarefa_id: tarefa.id, estado: 'realizado', calendar_event_id: tarefa.calendar_event_id ?? null })
    } else {
      await supabase.from('tarefas_followup').update({ estado: 'realizado', feito_em: new Date().toISOString() }).eq('id', tarefa.id)
    }
    loadAll()
  }

  async function adiar(tarefa: TarefaHoje) {
    const nova = new Date(tarefa.data_prevista)
    nova.setDate(nova.getDate() + 7)
    await supabase.from('tarefas_followup').update({ estado: 'adiado', data_prevista: nova.toISOString().slice(0, 10) }).eq('id', tarefa.id)
    loadAll()
  }

  const hoje = tarefas.filter(t => t.urgencia === 'hoje' || t.urgencia === 'atrasada')
  const semana = tarefas.filter(t => t.urgencia === 'esta_semana')
  const atrasadas = tarefas.filter(t => t.urgencia === 'atrasada')
  const pct = stats.totalAlunos ? Math.round(stats.convertidos / stats.totalAlunos * 100) : 0

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">A carregar...</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Briefing</h1>
        <p className="text-sm text-gray-500 capitalize">
          {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Activos" value={stats.totalAlunos} />
        <StatCard label="Com PT" value={stats.convertidos} sub={`${pct}%`} color="text-emerald-600" />
        <StatCard label="Sem plano" value={stats.semPlanoTotal} color={stats.semPlanoTotal > 0 ? 'text-amber-600' : undefined} />
        <StatCard label="Urgentes" value={hoje.length} color={hoje.length > 0 ? 'text-red-600' : undefined} />
      </div>

      {/* ATENÇÃO */}
      {(atrasadas.length > 0 || semPlano.length > 0 || briefingAberto) && (
        <section>
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1.5">⚠️ Atenção</p>
          <div className="space-y-1.5">
            {atrasadas.length > 0 && <Alert color="red"><strong>{atrasadas.length} follow-up{atrasadas.length > 1 ? 's' : ''} em atraso</strong></Alert>}
            {semPlano.map(a => <Alert key={`${a.num_socio}-${a.contacto}`} color="amber"><strong>{a.nome}</strong> sem plano há +14 dias</Alert>)}
            {briefingAberto && <Alert color="amber">Briefing do mês por fechar (passou o dia 5)</Alert>}
          </div>
        </section>
      )}

      {/* AVALIAÇÕES AMANHÃ */}
      {avaliacoesAmanha.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1.5">📋 Avaliações amanhã</p>
          <div className="space-y-1.5">
            {avaliacoesAmanha.map(s => {
              const hora = s.hora_inicio ? s.hora_inicio.slice(0, 5) : null
              const nome = s.nome ?? (s.num_socio ? `Nº ${s.num_socio}` : tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id)
              const link = s.contacto ? gerarLinkWhatsApp(s.contacto, gerarMensagemLembrete(nome, hora)) : null
              return (
                <div key={s.id} className="bg-white rounded-xl shadow-sm border border-blue-100 p-3">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="font-semibold text-sm text-gray-900">{nome}</span>
                    {hora && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{hora}</span>}
                    <span className="text-xs text-gray-400 ml-auto">{tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id}</span>
                  </div>
                  {link && (
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      className="block w-full text-center text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors">
                      Enviar lembrete WhatsApp
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* PLANOS NA APP */}
      {semPlanoApp.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1.5">📱 Planos por confirmar na app</p>
          <div className="space-y-1.5">
            {semPlanoApp.map(a => {
              const link = a.contacto ? gerarLinkWhatsApp(a.contacto, gerarMensagemPlanoPT(a.nome)) : null
              return (
                <div key={`${a.num_socio}-${a.contacto}`} className="bg-white rounded-xl shadow-sm border border-purple-100 p-3 flex items-center gap-3">
                  <span className="flex-1 text-sm font-semibold text-gray-900">{a.nome}</span>
                  {link && (
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2.5 py-1.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors whitespace-nowrap">
                      WhatsApp
                    </a>
                  )}
                  <button onClick={async () => {
                    await supabase.from('alunos').update({ plano_confirmado_em: new Date().toISOString().slice(0, 10) })
                      .eq('num_socio', a.num_socio).eq('contacto', a.contacto)
                    loadAll()
                  }}
                    className="text-xs px-2.5 py-1.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors whitespace-nowrap">
                    Confirmar ✓
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* SESSÕES DA SEMANA (hoje + próximos 7 dias, excl. natação) */}
      {(() => {
        const NATACAO = new Set(['n1','n2','n3','n4','n5','n6','n1f','n2f','n3f','n4f','n5f','n6f'])
        const hojeStr = new Date().toISOString().slice(0, 10)
        const semanaFiltrada = sessoesSemana.filter(s => !NATACAO.has(s.tipo_sessao_id))
        if (semanaFiltrada.length === 0) return null
        const dias = Array.from(new Set(semanaFiltrada.map(s => s.data_sessao)))
        return (
          <section>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">🏋️ Semana</p>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {dias.map((dia, diaIdx) => {
                const isHoje = dia === hojeStr
                const d = new Date(dia + 'T12:00:00')
                const diaSemana = d.toLocaleDateString('pt-PT', { weekday: 'short' }).replace('.','')
                const diaMes = d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
                const sessoesDia = semanaFiltrada.filter(s => s.data_sessao === dia)
                const totalDia = sessoesDia.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0)
                return (
                  <div key={dia} className={`flex gap-0 ${diaIdx > 0 ? 'border-t border-gray-100' : ''}`}>
                    {/* Coluna da data */}
                    <div className={`w-14 shrink-0 flex flex-col items-center justify-center py-2.5 ${isHoje ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500'}`}>
                      <span className="text-xs font-semibold uppercase">{diaSemana}</span>
                      <span className={`text-lg font-bold leading-tight ${isHoje ? 'text-white' : 'text-gray-800'}`}>{d.getDate()}</span>
                    </div>
                    {/* Sessões do dia */}
                    <div className="flex-1 min-w-0 py-1.5 px-2.5 space-y-1">
                      {sessoesDia.map(s => {
                        const tipo = tiposSessao.find(t => t.id === s.tipo_sessao_id)
                        const realizada = s.estado === 'realizada'
                        const label = s.nome ?? (s.num_socio ? `Nº ${s.num_socio}` : tipo?.nome ?? s.tipo_sessao_id)
                        const tipoLabel = tipo?.nome ?? s.tipo_sessao_id
                        const isTreino = s.tipo_sessao_id.startsWith('treino') || s.tipo_sessao_id === 'sw'
                        return (
                          <div key={s.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                            s.estado === 'cancelada' ? 'bg-gray-100 opacity-60' :
                            realizada ? 'bg-emerald-50' :
                            s.data_sessao <= hojeStr ? 'bg-red-50' : 'bg-gray-50'
                          }`}>
                            {s.data_sessao <= hojeStr && s.estado !== 'cancelada' && (
                              realizada ? (
                                <button onClick={() => toggleSessao(s)} title="Marcar como falta"
                                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs font-bold border-2 bg-emerald-500 border-emerald-500 text-white transition-colors hover:bg-red-400 hover:border-red-400">
                                  ✓
                                </button>
                              ) : (
                                <button onClick={() => toggleSessao(s)} title="Confirmar presença"
                                  className="shrink-0 text-xs px-1.5 py-0.5 rounded-md bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors">
                                  OK
                                </button>
                              )
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-semibold text-gray-900">{label}</span>
                              {s.hora_inicio && <span className="text-xs text-gray-400 ml-1.5">{s.hora_inicio.slice(0,5)}</span>}
                              {!isTreino && <span className="text-xs text-gray-400 ml-1.5">· {tipoLabel}</span>}
                            </div>
                            {s.valor_calculado ? <span className="text-xs font-semibold text-gray-600 shrink-0">{fmt(s.valor_calculado)}</span> : null}
                          </div>
                        )
                      })}
                    </div>
                    {/* Total do dia */}
                    {totalDia > 0 && (
                      <div className="shrink-0 flex items-center justify-center px-2.5 border-l border-gray-100">
                        <span className="text-xs font-bold text-emerald-700">{fmt(totalDia)}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })()}

      {/* HOJE */}
      <section>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">📅 Follow-ups para hoje</p>
        {hoje.length === 0
          ? <p className="text-sm text-gray-400">Nenhum follow-up para hoje.</p>
          : <div className="space-y-1.5">{hoje.map(t => <TarefaCard key={t.id} tarefa={t} onFeita={marcarFeita} onAdiar={adiar} />)}</div>
        }
      </section>

      {/* ESTA SEMANA */}
      <section>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">📆 Esta semana</p>
        {semana.length === 0
          ? <p className="text-sm text-gray-400">Sem follow-ups esta semana.</p>
          : <div className="space-y-1.5">{semana.map(t => <TarefaCard key={t.id} tarefa={t} onFeita={marcarFeita} onAdiar={adiar} />)}</div>
        }
      </section>

      {/* MÊS EM CURSO */}
      {mes && (
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">💶 Mês em curso</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 grid grid-cols-4 gap-3">
            <FinStat label="Bruto" value={fmt(mes.bruto_acumulado)} />
            <FinStat label="Nível" value={mes.nivel_atual != null ? `Nível ${mes.nivel_atual}` : '—'} />
            <FinStat label="Horas" value={mes.horas_nivel != null ? `${mes.horas_nivel}h` : '—'} />
            <FinStat label="Líquido est." value={fmt(mes.liquido_estimado)} highlight />
          </div>
        </section>
      )}
    </div>
  )
}

function Alert({ children, color }: { children: React.ReactNode; color: 'red' | 'amber' }) {
  const cls = color === 'red' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
  return <div className={`border rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>
}

function TarefaCard({ tarefa, onFeita, onAdiar }: { tarefa: TarefaHoje; onFeita: (t: TarefaHoje) => void; onAdiar: (t: TarefaHoje) => void }) {
  const link = gerarLinkWhatsApp(tarefa.contacto, gerarMensagem(tarefa.nome, tarefa.aluno_tipo, tarefa.tipo))
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="font-semibold text-sm text-gray-900">{tarefa.nome}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${URGENCIA_COLOR[tarefa.urgencia]}`}>{URGENCIA_LABEL[tarefa.urgencia]}</span>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">{MARCO_LABEL[tarefa.tipo]}</span>
        <span className="text-xs text-gray-400 ml-auto">{tarefa.data_prevista}</span>
      </div>
      <div className="flex gap-1.5">
        <a href={link} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors">WhatsApp</a>
        <button onClick={() => onFeita(tarefa)} className="flex-1 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">Feito</button>
        <button onClick={() => onAdiar(tarefa)} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors">+7d</button>
      </div>
    </div>
  )
}

function FinStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${highlight ? 'text-emerald-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2.5">
      <p className="text-xs text-gray-400 font-medium truncate">{label}</p>
      <p className={`text-2xl font-bold leading-tight ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 font-medium">{sub}</p>}
    </div>
  )
}
