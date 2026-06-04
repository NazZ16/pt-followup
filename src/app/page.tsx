'use client'

import { useEffect, useState } from 'react'
import { supabase, TarefaHoje, MesCorrente, Aluno } from '@/lib/supabase'
import { gerarMensagem, gerarLinkWhatsApp } from '@/lib/whatsapp'

const URGENCIA_COLOR: Record<string, string> = {
  atrasada: 'bg-red-100 text-red-800',
  hoje: 'bg-yellow-100 text-yellow-800',
  esta_semana: 'bg-blue-100 text-blue-800',
  futura: 'bg-gray-100 text-gray-700',
}
const URGENCIA_LABEL: Record<string, string> = {
  atrasada: 'Atrasada', hoje: 'Hoje', esta_semana: 'Esta semana', futura: 'Futura',
}
const MARCO_LABEL: Record<string, string> = { d7: 'D+7', d30: 'D+30', d60: 'D+60', d120: 'D+120' }

function fmt(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

export default function BriefingPage() {
  const [tarefas, setTarefas] = useState<TarefaHoje[]>([])
  const [mes, setMes] = useState<MesCorrente | null>(null)
  const [semPlano, setSemPlano] = useState<Aluno[]>([])
  const [briefingAberto, setBriefingAberto] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

    const [{ data: t }, { data: m }, { data: a }, { data: b }] = await Promise.all([
      supabase.from('v_tarefas_hoje').select('*').order('data_prevista'),
      supabase.from('v_mes_corrente').select('*').maybeSingle(),
      supabase.from('alunos').select('*').is('plano_confirmado_em', null).lt('ultima_avaliacao', cutoff),
      supabase.from('briefings').select('*').eq('estado', 'aberto'),
    ])

    setTarefas((t as TarefaHoje[]) || [])
    setMes(m as MesCorrente | null)
    setSemPlano((a as Aluno[]) || [])
    setBriefingAberto(!!b?.length && new Date().getDate() > 5)
    setLoading(false)
  }

  async function marcarFeita(tarefa: TarefaHoje) {
    await supabase.from('tarefas_followup').update({ estado: 'realizado', feito_em: new Date().toISOString() }).eq('id', tarefa.id)
    loadAll()
  }

  async function adiar(tarefa: TarefaHoje) {
    const nova = new Date(tarefa.data_prevista)
    nova.setDate(nova.getDate() + 7)
    await supabase.from('tarefas_followup').update({ estado: 'adiado', data_prevista: nova.toISOString().slice(0, 10) }).eq('id', tarefa.id)
    loadAll()
  }

  const hoje = tarefas.filter((t) => t.urgencia === 'hoje' || t.urgencia === 'atrasada')
  const semana = tarefas.filter((t) => t.urgencia === 'esta_semana')
  const atrasadas = tarefas.filter((t) => t.urgencia === 'atrasada')

  if (loading) return <p className="text-gray-500 text-sm">A carregar...</p>

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Briefing diário</h1>

      {(atrasadas.length > 0 || semPlano.length > 0 || briefingAberto) && (
        <section>
          <h2 className="text-base font-semibold text-red-700 mb-3">⚠️ Atenção</h2>
          <div className="space-y-2">
            {atrasadas.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                {atrasadas.length} tarefa{atrasadas.length > 1 ? 's' : ''} em atraso
              </div>
            )}
            {semPlano.map((a) => (
              <div key={`${a.num_socio}-${a.contacto}`} className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                <strong>{a.nome}</strong> — sem confirmação de plano há mais de 14 dias
              </div>
            ))}
            {briefingAberto && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                Briefing do mês corrente por fechar (já passaram do dia 5)
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold mb-3">📅 Hoje</h2>
        {hoje.length === 0
          ? <p className="text-sm text-gray-500">Nenhum follow-up para hoje.</p>
          : <div className="space-y-2">{hoje.map((t) => <TarefaCard key={t.id} tarefa={t} onFeita={marcarFeita} onAdiar={adiar} />)}</div>
        }
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3">📆 Esta semana</h2>
        {semana.length === 0
          ? <p className="text-sm text-gray-500">Sem follow-ups esta semana.</p>
          : <div className="space-y-2">{semana.map((t) => <TarefaCard key={t.id} tarefa={t} onFeita={marcarFeita} onAdiar={adiar} />)}</div>
        }
      </section>

      {mes && (
        <section>
          <h2 className="text-base font-semibold mb-3">💰 Mês em curso</h2>
          <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Bruto acumulado" value={fmt(mes.bruto_acumulado)} />
            <Stat label="Nível atual" value={mes.nivel_atual != null ? `Nível ${mes.nivel_atual}` : '—'} />
            <Stat label="Horas contadas" value={mes.horas_nivel != null ? `${mes.horas_nivel}h` : '—'} />
            <Stat label="Líquido estimado" value={fmt(mes.liquido_estimado)} />
          </div>
        </section>
      )}
    </div>
  )
}

function TarefaCard({ tarefa, onFeita, onAdiar }: { tarefa: TarefaHoje; onFeita: (t: TarefaHoje) => void; onAdiar: (t: TarefaHoje) => void }) {
  const mensagem = gerarMensagem(tarefa.nome, tarefa.aluno_tipo, tarefa.tipo)
  const link = gerarLinkWhatsApp(tarefa.contacto, mensagem)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{tarefa.nome}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${URGENCIA_COLOR[tarefa.urgencia]}`}>
            {URGENCIA_LABEL[tarefa.urgencia]}
          </span>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {MARCO_LABEL[tarefa.tipo]}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{tarefa.data_prevista}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <a href={link} target="_blank" rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
          WhatsApp
        </a>
        <button onClick={() => onFeita(tarefa)}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          Feito
        </button>
        <button onClick={() => onAdiar(tarefa)}
          className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
          Adiar 7d
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
