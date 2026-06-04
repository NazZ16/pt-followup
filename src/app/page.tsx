'use client'

import { useEffect, useState } from 'react'
import { supabase, TarefaHoje, MesCorrente, Aluno, Sessao, TipoSessaoRow } from '@/lib/supabase'
import { gerarMensagem, gerarMensagemLembrete, gerarLinkWhatsApp } from '@/lib/whatsapp'
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
  const [briefingAberto, setBriefingAberto] = useState(false)
  const [sessoesHoje, setSessoesHoje] = useState<(Sessao & { nome?: string })[]>([])
  const [avaliacoesAmanha, setAvaliacoesAmanha] = useState<(Sessao & { nome?: string })[]>([])
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [stats, setStats] = useState({ totalAlunos: 0, convertidos: 0, semPlanoTotal: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const hoje = new Date().toISOString().slice(0, 10)
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    const [{ data: t }, { data: m }, { data: a }, { data: b }, { data: sh }, { data: sa }, { data: ts }, { data: allAlunos }] = await Promise.all([
      supabase.from('v_tarefas_hoje').select('*').order('data_prevista'),
      supabase.from('v_mes_corrente').select('*').maybeSingle(),
      supabase.from('alunos').select('*').is('plano_confirmado_em', null).lt('ultima_avaliacao', cutoff).eq('estado', 'ativo'),
      supabase.from('briefings').select('*').eq('estado', 'aberto'),
      supabase.from('sessoes').select('*, alunos(nome)').eq('data_sessao', hoje).eq('estado', 'realizada'),
      supabase.from('sessoes').select('*, alunos(nome)').eq('data_sessao', amanha),
      supabase.from('tipos_sessao').select('*'),
      supabase.from('alunos').select('convertido, plano_confirmado_em, estado'),
    ])
    setTarefas((t as TarefaHoje[]) || [])
    setMes(m as MesCorrente | null)
    setSemPlano((a as Aluno[]) || [])
    setBriefingAberto(!!b?.length && new Date().getDate() > 5)
    setSessoesHoje(((sh as (Sessao & { alunos?: { nome: string } })[]) || []).map(s => ({ ...s, nome: s.alunos?.nome })))
    const tsData = (ts as TipoSessaoRow[]) || []
    setTiposSessao(tsData)
    const avalIds = new Set(tsData.filter(x => x.categoria === 'avaliacao').map(x => x.id))
    setAvaliacoesAmanha(
      ((sa as (Sessao & { alunos?: { nome: string } })[]) || [])
        .filter(s => avalIds.has(s.tipo_sessao_id))
        .map(s => ({ ...s, nome: s.alunos?.nome }))
    )
    const aa = (allAlunos as { convertido: boolean; plano_confirmado_em: string | null; estado: string }[]) || []
    setStats({
      totalAlunos: aa.filter(x => x.estado === 'ativo').length,
      convertidos: aa.filter(x => x.convertido && x.estado === 'ativo').length,
      semPlanoTotal: aa.filter(x => !x.plano_confirmado_em && x.estado === 'ativo').length,
    })
    setLoading(false)
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
              const nome = s.nome ?? `Nº ${s.num_socio}`
              const link = gerarLinkWhatsApp(s.contacto, gerarMensagemLembrete(nome, hora))
              return (
                <div key={s.id} className="bg-white rounded-xl shadow-sm border border-blue-100 p-3">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="font-semibold text-sm text-gray-900">{nome}</span>
                    {hora && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{hora}</span>}
                    <span className="text-xs text-gray-400 ml-auto">{tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id}</span>
                  </div>
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    className="block w-full text-center text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors">
                    Enviar lembrete WhatsApp
                  </a>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* SESSÕES HOJE */}
      {sessoesHoje.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">🏋️ Sessões de hoje</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
            {sessoesHoje.map(s => (
              <div key={s.id} className="px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm text-gray-900">{s.nome ?? `Nº ${s.num_socio}`}</span>
                  <span className="text-gray-400 mx-1.5">·</span>
                  <span className="text-sm text-gray-500">{tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id}</span>
                </div>
                {s.conta_horas && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">⏱ horas</span>}
                <span className="font-semibold text-sm text-gray-900">{fmt(s.valor_calculado)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
