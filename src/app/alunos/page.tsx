'use client'

import { useEffect, useState } from 'react'
import { supabase, Aluno, TarefaFollowup, TipoAluno, TipoFollowup } from '@/lib/supabase'
import { gerarMensagem, gerarLinkWhatsApp } from '@/lib/whatsapp'
import { confirmarPlanoViaScript, appsScriptConfigurado } from '@/lib/appsscript'

const TIPO_LABEL: Record<TipoAluno, string> = { rep: 'Rep', oi: 'OI', treino_oferta: 'Treino Oferta' }
const TIPO_COLOR: Record<TipoAluno, string> = {
  rep: 'bg-purple-100 text-purple-700',
  oi: 'bg-blue-100 text-blue-700',
  treino_oferta: 'bg-green-100 text-green-700',
}
const MARCO_LABEL: Record<TipoFollowup, string> = { '7d': 'D+7', '30d': 'D+30', '60d': 'D+60', '120d': 'D+120' }
const ESTADO_LABEL: Record<string, string> = {
  pendente: 'Pendente', realizado: 'Realizado', nao_realizado: 'Não realizado', adiado: 'Adiado',
}
const ESTADO_COLOR: Record<string, string> = {
  pendente: 'text-amber-600', realizado: 'text-green-600',
  nao_realizado: 'text-red-500', adiado: 'text-gray-400',
}

type AlunoComTarefas = Aluno & { tarefas: TarefaFollowup[]; todasTarefas: TarefaFollowup[] }

function initials(nome: string) {
  return nome.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

export default function AlunosPage() {
  const [alunos, setAlunos] = useState<AlunoComTarefas[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<TipoAluno | 'todos'>('todos')
  const [filtroConvertido, setFiltroConvertido] = useState<'todos' | 'pt' | 'nao_pt'>('todos')
  const [filtroPlano, setFiltroPlano] = useState<'todos' | 'confirmado' | 'sem_plano'>('todos')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [historicoAberto, setHistoricoAberto] = useState<string | null>(null)
  const [editandoNotas, setEditandoNotas] = useState<string | null>(null)
  const [notas, setNotas] = useState('')
  const [novoAluno, setNovoAluno] = useState(false)
  const [form, setForm] = useState({ num_socio: '', contacto: '', nome: '', tipo: 'rep' as TipoAluno, ultima_avaliacao: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: aData } = await supabase.from('alunos').select('*').order('nome')
    const { data: tData } = await supabase.from('tarefas_followup').select('*').order('data_prevista')

    const pendentesMap: Record<string, TarefaFollowup[]> = {}
    const todasMap: Record<string, TarefaFollowup[]> = {}
    for (const t of (tData as TarefaFollowup[]) || []) {
      const key = `${t.num_socio}-${t.contacto}`
      if (!todasMap[key]) todasMap[key] = []
      todasMap[key].push(t)
      if (t.estado === 'pendente' || t.estado === 'adiado') {
        if (!pendentesMap[key]) pendentesMap[key] = []
        pendentesMap[key].push(t)
      }
    }

    setAlunos(
      ((aData as Aluno[]) || []).map((a) => {
        const key = `${a.num_socio}-${a.contacto}`
        return { ...a, tarefas: pendentesMap[key] || [], todasTarefas: todasMap[key] || [] }
      })
    )
    setLoading(false)
  }

  async function confirmarPlano(aluno: Aluno) {
    const dataConfirmacao = aluno.ultima_avaliacao || new Date().toISOString().slice(0, 10)
    if (appsScriptConfigurado()) {
      await confirmarPlanoViaScript({ num_socio: aluno.num_socio, contacto: aluno.contacto, nome: aluno.nome, tipo: aluno.tipo, data_confirmacao: dataConfirmacao })
    } else {
      await supabase.from('alunos').update({ plano_confirmado_em: dataConfirmacao }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
      const marcos: { tipo: TipoFollowup; dias: number }[] = [
        { tipo: '7d', dias: 7 }, { tipo: '30d', dias: 30 }, { tipo: '60d', dias: 60 }, { tipo: '120d', dias: 120 },
      ]
      const base = new Date(dataConfirmacao)
      for (const { tipo, dias } of marcos) {
        const d = new Date(base)
        d.setDate(d.getDate() + dias)
        await supabase.from('tarefas_followup').insert({ num_socio: aluno.num_socio, contacto: aluno.contacto, tipo, data_prevista: d.toISOString().slice(0, 10), estado: 'pendente', mensagem: null })
      }
    }
    load()
  }

  async function toggleConvertido(aluno: Aluno) {
    await supabase.from('alunos').update({ convertido: !aluno.convertido }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    load()
  }

  async function toggleEstado(aluno: Aluno) {
    const novoEstado = aluno.estado === 'ativo' ? 'inativo' : 'ativo'
    await supabase.from('alunos').update({ estado: novoEstado }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    load()
  }

  async function guardarNotas(aluno: Aluno) {
    await supabase.from('alunos').update({ notas }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    setEditandoNotas(null)
    load()
  }

  async function salvarNovoAluno() {
    if (!form.num_socio || !form.contacto || !form.nome) return
    setSaving(true)
    await supabase.from('alunos').upsert({ num_socio: form.num_socio, contacto: form.contacto, nome: form.nome, tipo: form.tipo, convertido: false, ultima_avaliacao: form.ultima_avaliacao || null }, { onConflict: 'num_socio,contacto' })
    setForm({ num_socio: '', contacto: '', nome: '', tipo: 'rep', ultima_avaliacao: '' })
    setNovoAluno(false)
    setSaving(false)
    load()
  }

  const filtrados = alunos.filter((a) => {
    if (!mostrarInativos && a.estado === 'inativo') return false
    if (busca && !a.nome.toLowerCase().includes(busca.toLowerCase()) && !a.num_socio.includes(busca) && !a.contacto.includes(busca)) return false
    if (filtroTipo !== 'todos' && a.tipo !== filtroTipo) return false
    if (filtroConvertido === 'pt' && !a.convertido) return false
    if (filtroConvertido === 'nao_pt' && a.convertido) return false
    if (filtroPlano === 'confirmado' && !a.plano_confirmado_em) return false
    if (filtroPlano === 'sem_plano' && a.plano_confirmado_em) return false
    return true
  })

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-gray-400 text-sm">A carregar...</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alunos</h1>
          <p className="text-sm text-gray-500">{filtrados.length} {filtrados.length === 1 ? 'aluno' : 'alunos'}</p>
        </div>
        <button onClick={() => setNovoAluno(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm">
          + Novo
        </button>
      </div>

      {/* FILTROS */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 space-y-2">
        <input type="search" placeholder="Pesquisar por nome, nº ou contacto..." value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        <div className="flex flex-wrap gap-2">
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoAluno | 'todos')}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todos os tipos</option>
            <option value="rep">Rep</option>
            <option value="oi">OI</option>
            <option value="treino_oferta">Treino Oferta</option>
          </select>
          <select value={filtroConvertido} onChange={(e) => setFiltroConvertido(e.target.value as 'todos' | 'pt' | 'nao_pt')}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">PT + não PT</option>
            <option value="pt">Só PT activo</option>
            <option value="nao_pt">Sem PT</option>
          </select>
          <select value={filtroPlano} onChange={(e) => setFiltroPlano(e.target.value as 'todos' | 'confirmado' | 'sem_plano')}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todos os planos</option>
            <option value="confirmado">Plano confirmado</option>
            <option value="sem_plano">Sem plano</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer ml-1">
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} className="rounded" />
            Inativos
          </label>
        </div>
      </div>

      {novoAluno && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
          <h2 className="font-semibold">Novo aluno</h2>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Nº sócio" value={form.num_socio} onChange={(e) => setForm({ ...form, num_socio: e.target.value })}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Contacto (9xxxxxxxx)" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Nome completo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className="col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoAluno })}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="rep">Rep</option>
              <option value="oi">OI</option>
              <option value="treino_oferta">Treino Oferta</option>
            </select>
            <input type="date" value={form.ultima_avaliacao} onChange={(e) => setForm({ ...form, ultima_avaliacao: e.target.value })}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={salvarNovoAluno} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Guardar
            </button>
            <button onClick={() => setNovoAluno(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtrados.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Nenhum aluno encontrado</p>}
        {filtrados.map((aluno) => {
          const key = `${aluno.num_socio}-${aluno.contacto}`
          const aberto = expandido === key
          const verHistorico = historicoAberto === key
          const inativo = aluno.estado === 'inativo'
          return (
            <div key={key} className={`bg-white rounded-2xl shadow-sm border overflow-hidden transition-opacity ${inativo ? 'opacity-50 border-gray-100' : 'border-gray-100'}`}>
              <button className="w-full text-left p-4 flex items-center gap-3" onClick={() => setExpandido(aberto ? null : key)}>
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  inativo ? 'bg-gray-100 text-gray-400' :
                  aluno.convertido ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {initials(aluno.nome)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{aluno.nome}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[aluno.tipo]}`}>{TIPO_LABEL[aluno.tipo]}</span>
                    {aluno.convertido && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">PT</span>}
                    {inativo && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-500">Inativo</span>}
                    {!aluno.plano_confirmado_em && !inativo && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Sem plano</span>}
                    {aluno.tarefas.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{aluno.tarefas.length} pendente{aluno.tarefas.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {aluno.contacto} · Nº {aluno.num_socio}
                    {aluno.ultima_avaliacao && ` · avaliação ${aluno.ultima_avaliacao}`}
                  </p>
                </div>
                <span className="text-gray-300 shrink-0">{aberto ? '▲' : '▼'}</span>
              </button>

              {aberto && (
                <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50/50">
                  {/* Ações */}
                  <div className="flex gap-2 flex-wrap">
                    {!aluno.plano_confirmado_em && !inativo && (
                      <button onClick={() => confirmarPlano(aluno)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                        ✓ Confirmar plano
                      </button>
                    )}
                    <button onClick={() => toggleConvertido(aluno)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${aluno.convertido ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                      {aluno.convertido ? '★ PT activo' : '☆ Marcar como PT'}
                    </button>
                    <button onClick={() => toggleEstado(aluno)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${inativo ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                      {inativo ? 'Reativar' : 'Inativar'}
                    </button>
                  </div>

                  {/* Notas */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notas</p>
                    {editandoNotas === key ? (
                      <div className="space-y-2">
                        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          placeholder="Notas sobre o aluno..." />
                        <div className="flex gap-2">
                          <button onClick={() => guardarNotas(aluno)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                            Guardar
                          </button>
                          <button onClick={() => setEditandoNotas(null)}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setEditandoNotas(key); setNotas(aluno.notas ?? '') }}
                        className="text-sm text-left w-full text-gray-600 hover:text-gray-900 transition-colors">
                        {aluno.notas ? <span>{aluno.notas}</span> : <span className="text-gray-400 italic">Adicionar nota...</span>}
                      </button>
                    )}
                  </div>

                  {/* Follow-ups pendentes */}
                  {aluno.tarefas.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Follow-ups pendentes</p>
                      <div className="space-y-1.5">
                        {aluno.tarefas.map((t) => {
                          const msg = gerarMensagem(aluno.nome, aluno.tipo, t.tipo)
                          const link = gerarLinkWhatsApp(aluno.contacto, msg)
                          return (
                            <div key={t.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                              <span className="font-semibold text-sm text-gray-900">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-sm text-gray-500">{t.data_prevista}</span>
                              <a href={link} target="_blank" rel="noopener noreferrer"
                                className="ml-auto text-sm font-semibold text-green-600 hover:text-green-700 transition-colors">
                                WhatsApp →
                              </a>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Histórico */}
                  {aluno.todasTarefas.length > 0 && (
                    <div>
                      <button onClick={() => setHistoricoAberto(verHistorico ? null : key)}
                        className="text-sm text-blue-600 font-medium hover:underline">
                        {verHistorico ? 'Ocultar histórico' : `Histórico (${aluno.todasTarefas.length} follow-ups)`}
                      </button>
                      {verHistorico && (
                        <div className="mt-2 space-y-1.5">
                          {aluno.todasTarefas.map((t) => (
                            <div key={t.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2 border border-gray-100">
                              <span className="font-medium text-sm text-gray-700">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-sm text-gray-500">{t.data_prevista}</span>
                              <span className={`ml-auto text-sm font-medium ${ESTADO_COLOR[t.estado]}`}>{ESTADO_LABEL[t.estado]}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
