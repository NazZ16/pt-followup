'use client'

import { useEffect, useState } from 'react'
import { supabase, TarefaHoje, MesCorrente, Aluno, Sessao, TipoSessaoRow } from '@/lib/supabase'
import { gerarMensagem, gerarLinkWhatsApp } from '@/lib/whatsapp'
import { marcarTarefaViaScript, appsScriptConfigurado } from '@/lib/appsscript'

const URGENCIA_COLOR: Record<string, string> = {
  atrasada: 'bg-red-100 text-red-700',
  hoje: 'bg-amber-100 text-amber-700',
  esta_semana: 'bg-blue-100 text-blue-700',
  futura: 'bg-gray-100 text-gray-600',
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
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [stats, setStats] = useState({ totalAlunos: 0, convertidos: 0, semPlanoTotal: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const hoje = new Date().toISOString().slice(0, 10)
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

    const [{ data: t }, { data: m }, { data: a }, { data: b }, { data: sh }, { data: ts }, { data: allAlunos }] = await Promise.all([
      supabase.from('v_tarefas_hoje').select('*').order('data_prevista'),
      supabase.from('v_mes_corrente').select('*').maybeSingle(),
      supabase.from('alunos').select('*').is('plano_confirmado_em', null).lt('ultima_avaliacao', cutoff).eq('estado', 'ativo'),
      supabase.from('briefings').select('*').eq('estado', 'aberto'),
      supabase.from('sessoes').select('*, alunos(nome)').eq('data_sessao', hoje).eq('estado', 'realizada'),
      supabase.from('tipos_sessao').select('*'),
      supabase.from('alunos').select('convertido, plano_confirmado_em, estado'),
    ])

    setTarefas((t as TarefaHoje[]) || [])
    setMes(m as MesCorrente | null)
    setSemPlano((a as Aluno[]) || [])
    setBriefingAberto(!!b?.length && new Date().getDate() > 5)
    setSessoesHoje(((sh as (Sessao & { alunos?: { nome: string } })[]) || []).map(s => ({ ...s, nome: s.alunos?.nome })))
    setTiposSessao((ts as TipoSessaoRow[]) || [])

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

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-gray-400 text-sm">A carregar...</p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Briefing</h1>
        <p className="text-sm text-gray-500 mt-0.5 capitalize">
          {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Alunos activos" value={stats.totalAlunos} />
        <StatCard label="Com PT" value={stats.convertidos} sub={`${pct}%`} color="text-emerald-600" />
        <StatCard label="Sem plano" value={stats.semPlanoTotal} color={stats.semPlanoTotal > 0 ? 'text-amber-600' : 'text-gray-900'} />
        <StatCard label="Follow-ups urgentes" value={hoje.length} color={hoje.length > 0 ? 'text-red-600' : 'text-gray-900'} />
      </div>

      {/* ATENÇÃO */}
      {(atrasadas.length > 0 || semPlano.length > 0 || briefingAberto) && (
        <section className="space-y-2">
          <SectionTitle icon="⚠️" label="Atenção" color="text-red-600" />
          {atrasadas.length > 0 && (
            <AlertCard color="red">
              <strong>{atrasadas.length} follow-up{atrasadas.length > 1 ? 's' : ''} em atraso</strong> — contactar hoje
            </AlertCard>
          )}
          {semPlano.map(a => (
            <AlertCard key={`${a.num_socio}-${a.contacto}`} color="amber">
              <strong>{a.nome}</strong> sem confirmação de plano há mais de 14 dias
            </AlertCard>
          ))}
          {briefingAberto && (
            <AlertCard color="amber">
              Briefing do mês corrente por fechar (já passou o dia 5)
            </AlertCard>
          )}
        </section>
      )}

      {/* SESSÕES DE HOJE */}
      {sessoesHoje.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon="🏋️" label="Sessões de hoje" />
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
            {sessoesHoje.map(s => (
              <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{s.nome ?? `Nº ${s.num_socio}`}</p>
                  <p className="text-sm text-gray-500">{tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id}</p>
                </div>
                {s.conta_horas && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">conta horas</span>
                )}
                <span className="font-semibold text-gray-900 text-sm">{fmt(s.valor_calculado)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* HOJE */}
      <section className="space-y-2">
        <SectionTitle icon="📅" label="Follow-ups para hoje" />
        {hoje.length === 0
          ? <EmptyState text="Nenhum follow-up para hoje" />
          : <div className="space-y-2">{hoje.map(t => <TarefaCard key={t.id} tarefa={t} onFeita={marcarFeita} onAdiar={adiar} />)}</div>
        }
      </section>

      {/* ESTA SEMANA */}
      <section className="space-y-2">
        <SectionTitle icon="📆" label="Esta semana" />
        {semana.length === 0
          ? <EmptyState text="Sem follow-ups esta semana" />
          : <div className="space-y-2">{semana.map(t => <TarefaCard key={t.id} tarefa={t} onFeita={marcarFeita} onAdiar={adiar} />)}</div>
        }
      </section>

      {/* MÊS EM CURSO */}
      {mes && (
        <section className="space-y-2">
          <SectionTitle icon="💶" label="Mês em curso" />
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 grid grid-cols-2 gap-4">
            <FinStat label="Bruto acumulado" value={fmt(mes.bruto_acumulado)} />
            <FinStat label="Nível atual" value={mes.nivel_atual != null ? `Nível ${mes.nivel_atual}` : '—'} />
            <FinStat label="Horas contadas" value={mes.horas_nivel != null ? `${mes.horas_nivel}h` : '—'} />
            <FinStat label="Líquido estimado" value={fmt(mes.liquido_estimado)} highlight />
          </div>
        </section>
      )}
    </div>
  )
}

function SectionTitle({ icon, label, color }: { icon: string; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span>{icon}</span>
      <h2 className={`font-semibold text-base ${color ?? 'text-gray-800'}`}>{label}</h2>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 py-2">{text}</p>
}

function AlertCard({ children, color }: { children: React.ReactNode; color: 'red' | 'amber' }) {
  const cls = color === 'red'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-800'
  return (
    <div className={`border rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>
  )
}

function TarefaCard({ tarefa, onFeita, onAdiar }: { tarefa: TarefaHoje; onFeita: (t: TarefaHoje) => void; onAdiar: (t: TarefaHoje) => void }) {
  const mensagem = gerarMensagem(tarefa.nome, tarefa.aluno_tipo, tarefa.tipo)
  const link = gerarLinkWhatsApp(tarefa.contacto, mensagem)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-gray-900">{tarefa.nome}</p>
          <p className="text-sm text-gray-500 mt-0.5">{tarefa.data_prevista}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${URGENCIA_COLOR[tarefa.urgencia]}`}>
            {URGENCIA_LABEL[tarefa.urgencia]}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600">
            {MARCO_LABEL[tarefa.tipo]}
          </span>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <a href={link} target="_blank" rel="noopener noreferrer"
          className="flex-1 text-center text-sm px-3 py-2 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors">
          WhatsApp
        </a>
        <button onClick={() => onFeita(tarefa)}
          className="flex-1 text-sm px-3 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors">
          Feito
        </button>
        <button onClick={() => onAdiar(tarefa)}
          className="text-sm px-3 py-2 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors">
          Adiar 7d
        </button>
      </div>
    </div>
  )
}

function FinStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${highlight ? 'text-emerald-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <div className="flex items-end gap-2 mt-1">
        <p className={`text-3xl font-bold leading-none ${color ?? 'text-gray-900'}`}>{value}</p>
        {sub && <p className="text-sm text-gray-400 mb-0.5 font-medium">{sub}</p>}
      </div>
    </div>
  )
}
