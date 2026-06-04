'use client'

import { useEffect, useState } from 'react'
import { supabase, Aluno, TarefaFollowup, TipoAluno } from '@/lib/supabase'
import { gerarMensagem, gerarLinkWhatsApp } from '@/lib/whatsapp'
import { confirmarPlanoViaScript, appsScriptConfigurado } from '@/lib/appsscript'

const TIPO_LABEL: Record<TipoAluno, string> = { rep: 'Rep', oi: 'OI', treino_oferta: 'Treino Oferta' }
const TIPO_COLOR: Record<TipoAluno, string> = {
  rep: 'bg-purple-100 text-purple-800',
  oi: 'bg-blue-100 text-blue-800',
  treino_oferta: 'bg-green-100 text-green-800',
}
const MARCO_LABEL: Record<string, string> = { d7: 'D+7', d30: 'D+30', d60: 'D+60', d120: 'D+120' }
const ESTADO_LABEL: Record<string, string> = {
  pendente: 'Pendente', realizado: 'Realizado', nao_realizado: 'Não realizado', adiado: 'Adiado',
}

type AlunoComTarefas = Aluno & { tarefas: TarefaFollowup[] }

export default function AlunosPage() {
  const [alunos, setAlunos] = useState<AlunoComTarefas[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [novoAluno, setNovoAluno] = useState(false)
  const [form, setForm] = useState({ num_socio: '', contacto: '', nome: '', tipo: 'rep' as TipoAluno, ultima_avaliacao: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: aData } = await supabase.from('alunos').select('*').order('nome')
    const { data: tData } = await supabase
      .from('tarefas_followup')
      .select('*')
      .in('estado', ['pendente', 'adiado'])
      .order('data_prevista')

    const tarefasByAluno: Record<string, TarefaFollowup[]> = {}
    for (const t of (tData as TarefaFollowup[]) || []) {
      const key = `${t.num_socio}-${t.contacto}`
      if (!tarefasByAluno[key]) tarefasByAluno[key] = []
      tarefasByAluno[key].push(t)
    }

    setAlunos(
      ((aData as Aluno[]) || []).map((a) => ({
        ...a,
        tarefas: tarefasByAluno[`${a.num_socio}-${a.contacto}`] || [],
      }))
    )
    setLoading(false)
  }

  async function confirmarPlano(aluno: Aluno) {
    const dataConfirmacao = new Date().toISOString().slice(0, 10)

    if (appsScriptConfigurado()) {
      // Apps Script cria eventos no Calendar + tarefas no Supabase
      await confirmarPlanoViaScript({
        num_socio: aluno.num_socio,
        contacto: aluno.contacto,
        nome: aluno.nome,
        tipo: aluno.tipo,
        data_confirmacao: dataConfirmacao,
      })
    } else {
      // Fallback: escrever directamente no Supabase sem eventos Calendar
      await supabase
        .from('alunos')
        .update({ plano_confirmado_em: dataConfirmacao })
        .eq('num_socio', aluno.num_socio)
        .eq('contacto', aluno.contacto)

      const marcos = ['d7', 'd30', 'd60', 'd120']
      const dias = [7, 30, 60, 120]
      const base = aluno.ultima_avaliacao ? new Date(aluno.ultima_avaliacao) : new Date()
      const tarefas = marcos.map((m, i) => {
        const d = new Date(base)
        d.setDate(d.getDate() + dias[i])
        return {
          num_socio: aluno.num_socio,
          contacto: aluno.contacto,
          tipo: m,
          data_prevista: d.toISOString().slice(0, 10),
          estado: 'pendente',
          mensagem: null,
        }
      })
      await supabase.from('tarefas_followup').upsert(tarefas, { onConflict: 'num_socio,contacto,tipo' })
    }
    load()
  }

  async function toggleConvertido(aluno: Aluno) {
    await supabase
      .from('alunos')
      .update({ convertido: !aluno.convertido })
      .eq('num_socio', aluno.num_socio)
      .eq('contacto', aluno.contacto)
    load()
  }

  async function salvarNovoAluno() {
    if (!form.num_socio || !form.contacto || !form.nome) return
    setSaving(true)
    await supabase.from('alunos').upsert({
      num_socio: form.num_socio,
      contacto: form.contacto,
      nome: form.nome,
      tipo: form.tipo,
      convertido: false,
      ultima_avaliacao: form.ultima_avaliacao || null,
    }, { onConflict: 'num_socio,contacto' })
    setForm({ num_socio: '', contacto: '', nome: '', tipo: 'rep', ultima_avaliacao: '' })
    setNovoAluno(false)
    setSaving(false)
    load()
  }

  const filtrados = alunos.filter((a) =>
    a.nome.toLowerCase().includes(busca.toLowerCase()) ||
    a.num_socio.includes(busca) ||
    a.contacto.includes(busca)
  )

  if (loading) return <p className="text-sm text-gray-500">A carregar...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Alunos</h1>
        <button onClick={() => setNovoAluno(true)}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          + Novo aluno
        </button>
      </div>

      <input type="search" placeholder="Pesquisar nome, nº sócio ou contacto..."
        value={busca} onChange={(e) => setBusca(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

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
            <button onClick={salvarNovoAluno} disabled={saving}
              className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Guardar
            </button>
            <button onClick={() => setNovoAluno(false)}
              className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtrados.length === 0 && <p className="text-sm text-gray-500">Nenhum aluno encontrado.</p>}
        {filtrados.map((aluno) => {
          const key = `${aluno.num_socio}-${aluno.contacto}`
          const aberto = expandido === key
          return (
            <div key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button className="w-full text-left p-3 flex items-center gap-3"
                onClick={() => setExpandido(aberto ? null : key)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{aluno.nome}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[aluno.tipo]}`}>
                      {TIPO_LABEL[aluno.tipo]}
                    </span>
                    {aluno.convertido && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800">PT</span>
                    )}
                    {!aluno.plano_confirmado_em && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">Sem plano</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {aluno.contacto} · Nº {aluno.num_socio}
                    {aluno.ultima_avaliacao && ` · Avaliação: ${aluno.ultima_avaliacao}`}
                  </p>
                </div>
                <span className="text-gray-400 text-xs">{aberto ? '▲' : '▼'}</span>
              </button>

              {aberto && (
                <div className="border-t border-gray-100 p-3 space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {!aluno.plano_confirmado_em && (
                      <button onClick={() => confirmarPlano(aluno)}
                        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        ✓ Plano na app
                      </button>
                    )}
                    <button onClick={() => toggleConvertido(aluno)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        aluno.convertido
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}>
                      {aluno.convertido ? '★ PT activo' : '☆ Marcar como PT'}
                    </button>
                  </div>

                  {aluno.tarefas.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1">Follow-ups pendentes</p>
                      <div className="space-y-1">
                        {aluno.tarefas.map((t) => {
                          const msg = gerarMensagem(aluno.nome, aluno.tipo, t.tipo)
                          const link = gerarLinkWhatsApp(aluno.contacto, msg)
                          return (
                            <div key={t.id} className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1.5">
                              <span className="font-medium">{MARCO_LABEL[t.tipo]}</span>
                              <span className="text-gray-400">·</span>
                              <span>{t.data_prevista}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-500">{ESTADO_LABEL[t.estado]}</span>
                              <a href={link} target="_blank" rel="noopener noreferrer"
                                className="ml-auto text-green-700 font-medium hover:underline">
                                WhatsApp
                              </a>
                            </div>
                          )
                        })}
                      </div>
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
