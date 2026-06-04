'use client'

import { useEffect, useState } from 'react'
import { supabase, Aluno, TarefaFollowup, TipoAluno, TipoFollowup } from '@/lib/supabase'
import { gerarMensagem, gerarLinkWhatsApp } from '@/lib/whatsapp'
import { confirmarPlanoViaScript, appsScriptConfigurado } from '@/lib/appsscript'

const TIPO_LABEL: Record<TipoAluno, string> = { rep: 'Rep', oi: 'OI', treino_oferta: 'Treino Oferta' }
const TIPO_COLOR: Record<TipoAluno, string> = {
  rep: 'bg-purple-100 text-purple-800',
  oi: 'bg-blue-100 text-blue-800',
  treino_oferta: 'bg-green-100 text-green-800',
}
const MARCO_LABEL: Record<TipoFollowup, string> = { '7d': 'D+7', '30d': 'D+30', '60d': 'D+60', '120d': 'D+120' }
const ESTADO_LABEL: Record<string, string> = {
  pendente: 'Pendente', realizado: 'Realizado', nao_realizado: 'Não realizado', adiado: 'Adiado',
}
const ESTADO_COLOR: Record<string, string> = {
  pendente: 'text-yellow-700', realizado: 'text-green-700',
  nao_realizado: 'text-red-600', adiado: 'text-gray-500',
}

type AlunoComTarefas = Aluno & { tarefas: TarefaFollowup[]; todasTarefas: TarefaFollowup[] }

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

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Alunos <span className="text-sm font-normal text-gray-500">({filtrados.length})</span></h1>
        <button onClick={() => setNovoAluno(true)} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          + Novo aluno
        </button>
      </div>

      {/* FILTROS */}
      <div className="flex flex-wrap gap-2">
        <input type="search" placeholder="Pesquisar..." value={busca} onChange={(e) => setBusca(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoAluno | 'todos')}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="todos">Todos os tipos</option>
          <option value="rep">Rep</option>
          <option value="oi">OI</option>
          <option value="treino_oferta">Treino Oferta</option>
        </select>
        <select value={filtroConvertido} onChange={(e) => setFiltroConvertido(e.target.value as 'todos' | 'pt' | 'nao_pt')}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="todos">PT + não PT</option>
          <option value="pt">Só PT activo</option>
          <option value="nao_pt">Sem PT</option>
        </select>
        <select value={filtroPlano} onChange={(e) => setFiltroPlano(e.target.value as 'todos' | 'confirmado' | 'sem_plano')}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="todos">Todos os planos</option>
          <option value="confirmado">Plano confirmado</option>
          <option value="sem_plano">Sem plano</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} className="rounded" />
          Mostrar inativos
        </label>
      </div>

      {novoAluno && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm">Novo aluno</h2>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Nº sócio" value={form.num_socio} onChange={(e) => setForm({ ...form, num_socio: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Contacto (9xxxxxxxx)" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className="col-span-2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoAluno })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="rep">Rep</option>
              <option value="oi">OI</option>
              <option value="treino_oferta">Treino Oferta</option>
            </select>
            <input type="date" value={form.ultima_avaliacao} onChange={(e) => setForm({ ...form, ultima_avaliacao: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={salvarNovoAluno} disabled={saving} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Guardar</button>
            <button onClick={() => setNovoAluno(false)} className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtrados.length === 0 && <p className="text-sm text-gray-500">Nenhum aluno encontrado.</p>}
        {filtrados.map((aluno) => {
          const key = `${aluno.num_socio}-${aluno.contacto}`
          const aberto = expandido === key
          const verHistorico = historicoAberto === key
          const inativo = aluno.estado === 'inativo'
          return (
            <div key={key} className={`bg-white border rounded-xl overflow-hidden ${inativo ? 'border-gray-200 opacity-60' : 'border-gray-200'}`}>
              <button className="w-full text-left p-3 flex items-center gap-3" onClick={() => setExpandido(aberto ? null : key)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{aluno.nome}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[aluno.tipo]}`}>{TIPO_LABEL[aluno.tipo]}</span>
                    {aluno.convertido && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800">PT</span>}
                    {inativo && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-600">Inativo</span>}
                    {!aluno.plano_confirmado_em && !inativo && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">Sem plano</span>}
                    {aluno.tarefas.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-800">{aluno.tarefas.length} pendente{aluno.tarefas.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {aluno.contacto} · Nº {aluno.num_socio}
                    {aluno.ultima_avaliacao && ` · ${aluno.ultima_avaliacao}`}
                  </p>
                </div>
                <span className="text-gray-400 text-xs">{aberto ? '▲' : '▼'}</span>
              </button>

              {aberto && (
                <div className="border-t border-gray-100 p-3 space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {!aluno.plano_confirmado_em && !inativo && (
                      <button onClick={() => confirmarPlano(aluno)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        ✓ Plano na app
                      </button>
                    )}
                    <button onClick={() => toggleConvertido(aluno)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${aluno.convertido ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                      {aluno.convertido ? '★ PT activo' : '☆ Marcar como PT'}
                    </button>
                    <button onClick={() => toggleEstado(aluno)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${inativo ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                      {inativo ? 'Reativar' : 'Inativar'}
                    </button>
                  </div>

                  {/* Notas */}
                  <div>
                    {editandoNotas === key ? (
                      <div className="space-y-2">
                        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Notas sobre o aluno..." />
                        <div className="flex gap-2">
                          <button onClick={() => guardarNotas(aluno)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Guardar</button>
                          <button onClick={() => setEditandoNotas(null)} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setEditandoNotas(key); setNotas(aluno.notas ?? '') }}
                        className="text-xs text-gray-500 hover:text-gray-800 text-left w-full">
                        {aluno.notas ? <span className="italic">{aluno.notas}</span> : <span className="text-gray-400">+ Adicionar nota</span>}
                      </button>
                    )}
                  </div>

                  {/* Follow-ups pendentes */}
                  {aluno.tarefas.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1">Pendentes</p>
                      <div className="space-y-1">
                        {aluno.tarefas.map((t) => {
                          const msg = gerarMensagem(aluno.nome, aluno.tipo, t.tipo)
                          const link = gerarLinkWhatsApp(aluno.contacto, msg)
                          return (
                            <div key={t.id} className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1.5">
                              <span className="font-medium">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-gray-400">·</span>
                              <span>{t.data_prevista}</span>
                              <a href={link} target="_blank" rel="noopener noreferrer" className="ml-auto text-green-700 font-medium hover:underline">WhatsApp</a>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Histórico completo */}
                  {aluno.todasTarefas.length > 0 && (
                    <div>
                      <button onClick={() => setHistoricoAberto(verHistorico ? null : key)} className="text-xs text-blue-600 hover:underline">
                        {verHistorico ? 'Ocultar histórico' : `Ver histórico (${aluno.todasTarefas.length} follow-ups)`}
                      </button>
                      {verHistorico && (
                        <div className="mt-2 space-y-1">
                          {aluno.todasTarefas.map((t) => (
                            <div key={t.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1.5">
                              <span className="font-medium text-gray-700">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-600">{t.data_prevista}</span>
                              <span className={`ml-auto font-medium ${ESTADO_COLOR[t.estado]}`}>{ESTADO_LABEL[t.estado]}</span>
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
