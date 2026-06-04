'use client'

import { useEffect, useState } from 'react'
import { supabase, Aluno, TarefaFollowup, TipoAluno, TipoFollowup, ServicoPT } from '@/lib/supabase'
import { gerarMensagem, gerarLinkWhatsApp } from '@/lib/whatsapp'
import { confirmarPlanoViaScript, appsScriptConfigurado } from '@/lib/appsscript'

const TIPO_COLOR: Record<TipoAluno, string> = {
  rep: 'bg-purple-100 text-purple-700', oi: 'bg-blue-100 text-blue-700', treino_oferta: 'bg-green-100 text-green-700',
}
const TIPO_LABEL: Record<TipoAluno, string> = { rep: 'Rep', oi: 'OI', treino_oferta: 'Treino Oferta' }
const MARCO_LABEL: Record<TipoFollowup, string> = { '7d': 'D+7', '30d': 'D+30', '60d': 'D+60', '120d': 'D+120' }
const ESTADO_COLOR: Record<string, string> = {
  pendente: 'text-amber-600', realizado: 'text-green-600', nao_realizado: 'text-red-500', adiado: 'text-gray-400',
}
const ESTADO_LABEL: Record<string, string> = {
  pendente: 'Pendente', realizado: 'Realizado', nao_realizado: 'Não realizado', adiado: 'Adiado',
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
  const [editandoAluno, setEditandoAluno] = useState<string | null>(null)
  const [formEdit, setFormEdit] = useState({ nome: '', contacto: '', num_socio: '', tipo: 'rep' as TipoAluno, ultima_avaliacao: '' })
  const [novoAluno, setNovoAluno] = useState(false)
  const [form, setForm] = useState({ num_socio: '', contacto: '', nome: '', tipo: 'rep' as TipoAluno, ultima_avaliacao: '' })
  const [saving, setSaving] = useState(false)
  const [servicosPT, setServicosPT] = useState<ServicoPT[]>([])
  const [marcandoPT, setMarcandoPT] = useState<string | null>(null)
  const [formPT, setFormPT] = useState({ plano_pt: '', horas_pt_semanais: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: aData }, { data: tData }, { data: spData }] = await Promise.all([
      supabase.from('alunos').select('*').order('nome'),
      supabase.from('tarefas_followup').select('*').order('data_prevista'),
      supabase.from('servicos_pt').select('*').order('horas_semanais'),
    ])
    setServicosPT((spData as ServicoPT[]) || [])
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
    setAlunos(((aData as Aluno[]) || []).map(a => {
      const key = `${a.num_socio}-${a.contacto}`
      return { ...a, tarefas: pendentesMap[key] || [], todasTarefas: todasMap[key] || [] }
    }))
    setLoading(false)
  }

  async function confirmarPlano(aluno: Aluno) {
    const dataConfirmacao = aluno.ultima_avaliacao || new Date().toISOString().slice(0, 10)
    if (appsScriptConfigurado()) {
      await confirmarPlanoViaScript({ num_socio: aluno.num_socio, contacto: aluno.contacto, nome: aluno.nome, tipo: aluno.tipo, data_confirmacao: dataConfirmacao })
    } else {
      await supabase.from('alunos').update({ plano_confirmado_em: dataConfirmacao }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
      const base = new Date(dataConfirmacao)
      for (const [tipo, dias] of [['7d', 7], ['30d', 30], ['60d', 60], ['120d', 120]] as [TipoFollowup, number][]) {
        const d = new Date(base); d.setDate(d.getDate() + dias)
        await supabase.from('tarefas_followup').insert({ num_socio: aluno.num_socio, contacto: aluno.contacto, tipo, data_prevista: d.toISOString().slice(0, 10), estado: 'pendente', mensagem: null })
      }
    }
    load()
  }

  async function confirmarPT(aluno: Aluno) {
    await supabase.from('alunos').update({
      convertido: true,
      plano_pt: formPT.plano_pt || null,
      horas_pt_semanais: formPT.horas_pt_semanais ? Number(formPT.horas_pt_semanais) : null,
    }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    setMarcandoPT(null)
    setFormPT({ plano_pt: '', horas_pt_semanais: '' })
    load()
  }

  async function desmarcarPT(aluno: Aluno) {
    await supabase.from('alunos').update({ convertido: false, plano_pt: null, horas_pt_semanais: null }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    load()
  }

  async function toggleEstado(aluno: Aluno) {
    await supabase.from('alunos').update({ estado: aluno.estado === 'ativo' ? 'inativo' : 'ativo' }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    load()
  }

  async function guardarNotas(aluno: Aluno) {
    await supabase.from('alunos').update({ notas }).eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    setEditandoNotas(null); load()
  }

  async function guardarEdicaoAluno(aluno: Aluno) {
    await supabase.from('alunos').update({ nome: formEdit.nome, contacto: formEdit.contacto, num_socio: formEdit.num_socio, tipo: formEdit.tipo, ultima_avaliacao: formEdit.ultima_avaliacao || null })
      .eq('num_socio', aluno.num_socio).eq('contacto', aluno.contacto)
    setEditandoAluno(null); load()
  }

  async function salvarNovoAluno() {
    if (!form.num_socio || !form.contacto || !form.nome) return
    setSaving(true)
    await supabase.from('alunos').upsert({ num_socio: form.num_socio, contacto: form.contacto, nome: form.nome, tipo: form.tipo, convertido: false, ultima_avaliacao: form.ultima_avaliacao || null }, { onConflict: 'num_socio,contacto' })
    setForm({ num_socio: '', contacto: '', nome: '', tipo: 'rep', ultima_avaliacao: '' })
    setNovoAluno(false); setSaving(false); load()
  }

  const filtrados = alunos.filter(a => {
    if (!mostrarInativos && a.estado === 'inativo') return false
    if (busca && !a.nome.toLowerCase().includes(busca.toLowerCase()) && !a.num_socio.includes(busca) && !a.contacto.includes(busca)) return false
    if (filtroTipo !== 'todos' && a.tipo !== filtroTipo) return false
    if (filtroConvertido === 'pt' && !a.convertido) return false
    if (filtroConvertido === 'nao_pt' && a.convertido) return false
    if (filtroPlano === 'confirmado' && !a.plano_confirmado_em) return false
    if (filtroPlano === 'sem_plano' && a.plano_confirmado_em) return false
    return true
  })

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">A carregar...</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Alunos</h1>
          <p className="text-sm text-gray-400">{filtrados.length} {filtrados.length === 1 ? 'aluno' : 'alunos'}</p>
        </div>
        <button onClick={() => setNovoAluno(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
          + Novo
        </button>
      </div>

      {/* FILTROS */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2.5 space-y-2">
        <input type="search" placeholder="Pesquisar nome, nº sócio ou contacto..." value={busca} onChange={e => setBusca(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" />
        <div className="flex flex-wrap gap-1.5 items-center">
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoAluno | 'todos')}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todos os tipos</option>
            <option value="rep">Rep</option><option value="oi">OI</option><option value="treino_oferta">Treino Oferta</option>
          </select>
          <select value={filtroConvertido} onChange={e => setFiltroConvertido(e.target.value as 'todos' | 'pt' | 'nao_pt')}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">PT + não PT</option><option value="pt">Só PT</option><option value="nao_pt">Sem PT</option>
          </select>
          <select value={filtroPlano} onChange={e => setFiltroPlano(e.target.value as 'todos' | 'confirmado' | 'sem_plano')}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="todos">Todos os planos</option><option value="confirmado">Com plano</option><option value="sem_plano">Sem plano</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} className="rounded" />
            Inativos
          </label>
        </div>
      </div>

      {novoAluno && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-2.5">
          <p className="font-semibold text-sm">Novo aluno</p>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Nº sócio" value={form.num_socio} onChange={e => setForm({ ...form, num_socio: e.target.value })}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Contacto" value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input placeholder="Nome completo" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })}
              className="col-span-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value as TipoAluno })}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="rep">Rep</option><option value="oi">OI</option><option value="treino_oferta">Treino Oferta</option>
            </select>
            <input type="date" value={form.ultima_avaliacao} onChange={e => setForm({ ...form, ultima_avaliacao: e.target.value })}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={salvarNovoAluno} disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">Guardar</button>
            <button onClick={() => setNovoAluno(false)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {filtrados.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Nenhum aluno encontrado.</p>}
        {filtrados.map(aluno => {
          const key = `${aluno.num_socio}-${aluno.contacto}`
          const aberto = expandido === key
          const verHistorico = historicoAberto === key
          const inativo = aluno.estado === 'inativo'
          return (
            <div key={key} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${inativo ? 'opacity-60 border-gray-100' : 'border-gray-100'}`}>
              <button className="w-full text-left px-3 py-2.5 flex items-center gap-2.5" onClick={() => setExpandido(aberto ? null : key)}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${inativo ? 'bg-gray-100 text-gray-400' : aluno.convertido ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                  {initials(aluno.nome)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{aluno.nome}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TIPO_COLOR[aluno.tipo]}`}>{TIPO_LABEL[aluno.tipo]}</span>
                    {aluno.convertido && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">PT</span>}
                    {inativo && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-200 text-gray-500">Inativo</span>}
                    {!aluno.plano_confirmado_em && !inativo && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Sem plano</span>}
                    {aluno.tarefas.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{aluno.tarefas.length}✗</span>}
                  </div>
                  <p className="text-xs text-gray-400">
                    {aluno.contacto} · Nº {aluno.num_socio}{aluno.ultima_avaliacao && ` · ${aluno.ultima_avaliacao}`}
                    {aluno.plano_pt && ` · ${aluno.plano_pt}`}{aluno.horas_pt_semanais && ` · ${aluno.horas_pt_semanais}h/sem`}
                  </p>
                </div>
                <span className="text-gray-300 text-xs shrink-0">{aberto ? '▲' : '▼'}</span>
              </button>

              {aberto && (
                <div className="border-t border-gray-100 px-3 py-2.5 space-y-2.5 bg-gray-50/50">
                  {/* Ações */}
                  <div className="flex gap-1.5 flex-wrap">
                    {!aluno.plano_confirmado_em && !inativo && (
                      <button onClick={() => confirmarPlano(aluno)} className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">✓ Confirmar plano</button>
                    )}
                    {aluno.convertido ? (
                      <button onClick={() => desmarcarPT(aluno)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors bg-emerald-600 text-white hover:bg-emerald-700">
                        ★ PT activo
                      </button>
                    ) : (
                      <button onClick={() => { setMarcandoPT(key); setFormPT({ plano_pt: '', horas_pt_semanais: '' }) }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors bg-gray-200 text-gray-700 hover:bg-gray-300">
                        ☆ Marcar PT
                      </button>
                    )}
                    <button onClick={() => toggleEstado(aluno)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${inativo ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                      {inativo ? 'Reativar' : 'Inativar'}
                    </button>
                    <button onClick={() => { setEditandoAluno(key); setFormEdit({ nome: aluno.nome, contacto: aluno.contacto, num_socio: aluno.num_socio, tipo: aluno.tipo, ultima_avaliacao: aluno.ultima_avaliacao ?? '' }) }}
                      className="px-2.5 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300 transition-colors">✏️ Editar</button>
                  </div>

                  {/* Marcar PT — form de serviço */}
                  {marcandoPT === key && (
                    <div className="bg-white rounded-lg border border-emerald-200 p-2.5 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">Serviço fechado</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <select
                            value={formPT.plano_pt}
                            onChange={e => {
                              const sv = servicosPT.find(s => s.nome === e.target.value)
                              setFormPT({ plano_pt: e.target.value, horas_pt_semanais: sv ? String(sv.horas_semanais) : formPT.horas_pt_semanais })
                            }}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">Selecionar serviço...</option>
                            {servicosPT.map(sv => (
                              <option key={sv.id} value={sv.nome}>{sv.nome} ({sv.horas_semanais}h/sem)</option>
                            ))}
                            <option value="__outro__">Outro (manual)</option>
                          </select>
                        </div>
                        {(formPT.plano_pt === '__outro__' || (formPT.plano_pt && !servicosPT.find(s => s.nome === formPT.plano_pt))) && (
                          <input value={formPT.plano_pt === '__outro__' ? '' : formPT.plano_pt}
                            placeholder="Nome do serviço"
                            onChange={e => setFormPT({ ...formPT, plano_pt: e.target.value })}
                            className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        )}
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.5" min="0" value={formPT.horas_pt_semanais}
                            onChange={e => setFormPT({ ...formPT, horas_pt_semanais: e.target.value })}
                            placeholder="0"
                            className="w-20 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <span className="text-xs text-gray-500">horas/semana</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => confirmarPT(aluno)}
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors">
                          Confirmar PT
                        </button>
                        <button onClick={() => setMarcandoPT(null)}
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Plano PT activo */}
                  {aluno.convertido && (aluno.plano_pt || aluno.horas_pt_semanais) && (
                    <div className="bg-emerald-50 rounded-lg px-2.5 py-2 flex items-center gap-3">
                      <span className="text-xs font-semibold text-emerald-700">Plano PT</span>
                      {aluno.plano_pt && <span className="text-xs text-emerald-800">{aluno.plano_pt}</span>}
                      {aluno.horas_pt_semanais && <span className="text-xs text-emerald-700 ml-auto">{aluno.horas_pt_semanais}h/sem</span>}
                    </div>
                  )}

                  {/* Editar dados */}
                  {editandoAluno === key && (
                    <div className="bg-white rounded-lg border border-gray-200 p-2.5 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input value={formEdit.nome} onChange={e => setFormEdit({ ...formEdit, nome: e.target.value })} placeholder="Nome"
                          className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <input value={formEdit.num_socio} onChange={e => setFormEdit({ ...formEdit, num_socio: e.target.value })} placeholder="Nº sócio"
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <input value={formEdit.contacto} onChange={e => setFormEdit({ ...formEdit, contacto: e.target.value })} placeholder="Contacto"
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <select value={formEdit.tipo} onChange={e => setFormEdit({ ...formEdit, tipo: e.target.value as TipoAluno })}
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="rep">Rep</option><option value="oi">OI</option><option value="treino_oferta">Treino Oferta</option>
                        </select>
                        <input type="date" value={formEdit.ultima_avaliacao} onChange={e => setFormEdit({ ...formEdit, ultima_avaliacao: e.target.value })}
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => guardarEdicaoAluno(aluno)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors">Guardar</button>
                        <button onClick={() => setEditandoAluno(null)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors">Cancelar</button>
                      </div>
                    </div>
                  )}

                  {/* Notas */}
                  {editandoNotas === key ? (
                    <div className="space-y-1.5">
                      <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Notas..."
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                      <div className="flex gap-2">
                        <button onClick={() => guardarNotas(aluno)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors">Guardar</button>
                        <button onClick={() => setEditandoNotas(null)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setEditandoNotas(key); setNotas(aluno.notas ?? '') }}
                      className="text-sm text-left w-full text-gray-500 hover:text-gray-800 transition-colors">
                      {aluno.notas ? aluno.notas : <span className="text-gray-400 text-xs italic">+ Adicionar nota</span>}
                    </button>
                  )}

                  {/* Pendentes */}
                  {aluno.tarefas.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Pendentes</p>
                      <div className="space-y-1">
                        {aluno.tarefas.map(t => {
                          const link = gerarLinkWhatsApp(aluno.contacto, gerarMensagem(aluno.nome, aluno.tipo, t.tipo))
                          return (
                            <div key={t.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 border border-gray-100">
                              <span className="font-semibold text-sm text-gray-900">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-sm text-gray-400">{t.data_prevista}</span>
                              <a href={link} target="_blank" rel="noopener noreferrer" className="ml-auto text-sm font-semibold text-green-600 hover:text-green-700">WhatsApp →</a>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Histórico */}
                  {aluno.todasTarefas.length > 0 && (
                    <div>
                      <button onClick={() => setHistoricoAberto(verHistorico ? null : key)} className="text-xs text-blue-600 hover:underline">
                        {verHistorico ? 'Ocultar histórico' : `Histórico (${aluno.todasTarefas.length})`}
                      </button>
                      {verHistorico && (
                        <div className="mt-1.5 space-y-1">
                          {aluno.todasTarefas.map(t => (
                            <div key={t.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 border border-gray-100">
                              <span className="font-medium text-sm text-gray-700">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-sm text-gray-400">{t.data_prevista}</span>
                              <span className={`ml-auto text-xs font-medium ${ESTADO_COLOR[t.estado]}`}>{ESTADO_LABEL[t.estado]}</span>
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
