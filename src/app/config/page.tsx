'use client'

import { useEffect, useState } from 'react'
import { supabase, NivelRemuneracao, TipoSessaoRow, ConfigFiscal, BonusTrimestral, SsTrimestral, ConfigBonus } from '@/lib/supabase'

export default function ConfigPage() {
  const [niveis, setNiveis] = useState<NivelRemuneracao[]>([])
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [fiscal, setFiscal] = useState<ConfigFiscal | null>(null)
  const [bonus, setBonus] = useState<BonusTrimestral[]>([])
  const [configBonus, setConfigBonus] = useState<ConfigBonus[]>([])
  const [ss, setSs] = useState<SsTrimestral[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: n }, { data: ts }, { data: f }, { data: b }, { data: s }, { data: cb }] = await Promise.all([
      supabase.from('niveis_remuneracao').select('*').order('nivel'),
      supabase.from('tipos_sessao').select('*').order('id'),
      supabase.from('config_fiscal').select('*').order('vigente_desde', { ascending: false }).limit(1).single(),
      supabase.from('bonus_trimestral').select('*').order('ano', { ascending: false }),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }),
      supabase.from('config_bonus').select('*').order('horas_threshold'),
    ])
    setNiveis((n as NivelRemuneracao[]) || [])
    setTiposSessao((ts as TipoSessaoRow[]) || [])
    setFiscal(f as ConfigFiscal | null)
    setBonus((b as BonusTrimestral[]) || [])
    setSs((s as SsTrimestral[]) || [])
    setConfigBonus((cb as ConfigBonus[]) || [])
    setLoading(false)
  }

  function ok(m = 'Guardado.') { setErro(''); setMsg(m); setTimeout(() => setMsg(''), 3000) }
  function fail(e: unknown) { setMsg(''); setErro('Erro ao guardar: ' + String(e)) }

  async function calcularSsAutomatico() {
    const hoje = new Date()
    const trimAtual = Math.ceil((hoje.getMonth() + 1) / 3)
    const trimRef = trimAtual === 1 ? 4 : trimAtual - 1
    const anoRef = trimAtual === 1 ? hoje.getFullYear() - 1 : hoje.getFullYear()
    const mesInicio = (trimRef - 1) * 3 + 1
    const meses = [`${anoRef}-${String(mesInicio).padStart(2, '0')}`, `${anoRef}-${String(mesInicio + 1).padStart(2, '0')}`, `${anoRef}-${String(mesInicio + 2).padStart(2, '0')}`]
    const { data: brs } = await supabase.from('briefings').select('total_bruto').in('id', meses)
    const total = ((brs as { total_bruto: number }[]) || []).reduce((acc, b) => acc + (b.total_bruto ?? 0), 0)
    const proxTrim = trimAtual === 4 ? 1 : trimAtual + 1
    const proxAno = trimAtual === 4 ? hoje.getFullYear() + 1 : hoje.getFullYear()
    setSs([{
      id: 0, ano_referencia: anoRef, trimestre_referencia: trimRef,
      rendimento_relevante: total, base_incidencia: total / 3,
      contribuicao_mensal: Math.round((total / 3) * 0.214 * 100) / 100,
      ano_aplicacao: proxAno, trimestre_aplicacao: proxTrim,
    }, ...ss.filter(s => !(s.ano_referencia === anoRef && s.trimestre_referencia === trimRef))])
  }

  async function salvarNivel(n: NivelRemuneracao) {
    setSaving(true)
    const { error } = await supabase.from('niveis_remuneracao').update({
      horas_min: n.horas_min, horas_max: n.horas_max,
      valor_45min: n.valor_45min, valor_60min: n.valor_60min,
    }).eq('id', n.id)
    setSaving(false)
    if (error) fail(error.message); else ok()
  }

  async function salvarTipo(t: TipoSessaoRow) {
    setSaving(true)
    const { error } = await supabase.from('tipos_sessao').update({
      nome: t.nome, valor_fixo: t.valor_fixo, duracao_min: t.duracao_min, conta_para_nivel: t.conta_para_nivel,
    }).eq('id', t.id)
    setSaving(false)
    if (error) fail(error.message); else { ok(); load() }
  }

  const [novoTipo, setNovoTipo] = useState(false)
  const [formTipo, setFormTipo] = useState<Partial<TipoSessaoRow>>({
    id: '', nome: '', categoria: 'avaliacao', duracao_min: 60, valor_fixo: null, conta_para_nivel: false,
  })

  async function criarTipo() {
    if (!formTipo.id || !formTipo.nome) return
    setSaving(true)
    const { error } = await supabase.from('tipos_sessao').insert({
      id: formTipo.id, nome: formTipo.nome, categoria: formTipo.categoria,
      duracao_min: formTipo.duracao_min, valor_fixo: formTipo.valor_fixo ?? null,
      conta_para_nivel: formTipo.conta_para_nivel ?? false,
    })
    setNovoTipo(false)
    setFormTipo({ id: '', nome: '', categoria: 'avaliacao', duracao_min: 60, valor_fixo: null, conta_para_nivel: false })
    setSaving(false)
    if (error) fail(error.message); else { ok(); load() }
  }

  async function eliminarTipo(id: string) {
    setSaving(true)
    const { error } = await supabase.from('tipos_sessao').delete().eq('id', id)
    setSaving(false)
    if (error) fail(error.message); else { ok(); load() }
  }

  async function salvarFiscal() {
    if (!fiscal) return
    setSaving(true)
    const { error } = await supabase.from('config_fiscal').update({ taxa_irs: fiscal.taxa_irs }).eq('id', fiscal.id)
    setSaving(false)
    if (error) fail(error.message); else ok()
  }

  async function salvarConfigBonus(cb: ConfigBonus) {
    setSaving(true)
    let error = null
    if (cb.id) {
      ({ error } = await supabase.from('config_bonus').update({
        horas_threshold: cb.horas_threshold, valor_bonus: cb.valor_bonus,
      }).eq('id', cb.id))
    } else {
      ({ error } = await supabase.from('config_bonus').insert({
        horas_threshold: cb.horas_threshold, valor_bonus: cb.valor_bonus,
      }))
    }
    setSaving(false)
    if (error) fail(error.message); else { ok(); load() }
  }

  async function eliminarConfigBonus(id: number) {
    setSaving(true)
    const { error } = await supabase.from('config_bonus').delete().eq('id', id)
    setSaving(false)
    if (error) fail(error.message); else { ok(); load() }
  }

  function addConfigBonus() {
    setConfigBonus([...configBonus, { id: 0, horas_threshold: 0, valor_bonus: 0 }])
  }

  async function salvarSs(s: SsTrimestral) {
    setSaving(true)
    let error = null
    if (s.id) {
      ({ error } = await supabase.from('ss_trimestral').update({
        rendimento_relevante: s.rendimento_relevante,
        ano_aplicacao: s.ano_aplicacao, trimestre_aplicacao: s.trimestre_aplicacao,
      }).eq('id', s.id))
    } else {
      ({ error } = await supabase.from('ss_trimestral').insert({
        ano_referencia: s.ano_referencia, trimestre_referencia: s.trimestre_referencia,
        rendimento_relevante: s.rendimento_relevante,
        ano_aplicacao: s.ano_aplicacao, trimestre_aplicacao: s.trimestre_aplicacao,
      }))
    }
    setSaving(false)
    if (error) fail(error.message); else { ok(); load() }
  }

  function addSs() {
    const hoje = new Date()
    const trim = Math.ceil((hoje.getMonth() + 1) / 3)
    const proxTrim = trim === 4 ? 1 : trim + 1
    const proxAno = trim === 4 ? hoje.getFullYear() + 1 : hoje.getFullYear()
    setSs([{ id: 0, ano_referencia: hoje.getFullYear(), trimestre_referencia: trim, rendimento_relevante: 0, base_incidencia: 0, contribuicao_mensal: 0, ano_aplicacao: proxAno, trimestre_aplicacao: proxTrim }, ...ss])
  }

  const TIPOS_BASE = ['rep', 'oi', 'treino_oferta', 'treino_60', 'treino_45']
  // treino_45 e treino_60 não têm valor fixo — o valor é determinado pelo nível de horas
  const tiposVisiveis = tiposSessao.filter(t => t.id !== 'treino_45' && t.id !== 'treino_60')

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-gray-400 text-sm">A carregar...</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>

      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">{msg}</div>}
      {erro && <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3">{erro}</div>}

      {/* TIPOS DE SESSÃO */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base text-gray-800">Códigos da folha de vencimento</h2>
            <p className="text-xs text-gray-500 mt-0.5">treino_45 e treino_60 não estão aqui — o valor deles vem da tabela de níveis abaixo</p>
          </div>
          <button onClick={() => setNovoTipo(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 transition-colors shadow-sm">
            + Novo código
          </button>
        </div>

        {novoTipo && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3">
            <p className="font-semibold text-sm">Novo código</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Código (ID)</label>
                <input value={formTipo.id ?? ''} onChange={(e) => setFormTipo({ ...formTipo, id: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                  placeholder="ex: ginastica_laboral"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Nome</label>
                <input value={formTipo.nome ?? ''} onChange={(e) => setFormTipo({ ...formTipo, nome: e.target.value })}
                  placeholder="ex: Ginástica Laboral"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Categoria</label>
                <select value={formTipo.categoria} onChange={(e) => setFormTipo({ ...formTipo, categoria: e.target.value as 'avaliacao' | 'treino' })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="avaliacao">Avaliação (valor fixo)</option>
                  <option value="treino">Treino (por nível)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Duração (min)</label>
                <input type="number" value={formTipo.duracao_min ?? ''} onChange={(e) => setFormTipo({ ...formTipo, duracao_min: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Valor fixo (€)</label>
                <input type="number" step="0.01" value={formTipo.valor_fixo ?? ''} onChange={(e) => setFormTipo({ ...formTipo, valor_fixo: e.target.value ? Number(e.target.value) : null })}
                  placeholder="—"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={formTipo.conta_para_nivel ?? false} onChange={(e) => setFormTipo({ ...formTipo, conta_para_nivel: e.target.checked })} className="rounded" />
                  Conta para nível de horas
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={criarTipo} disabled={saving || !formTipo.id || !formTipo.nome}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                Criar
              </button>
              <button onClick={() => setNovoTipo(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Código</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Dur. (min)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Valor fixo (€)</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Conta horas</th>
                <th className="px-4 py-3 w-36"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tiposVisiveis.map((t) => {
                const i = tiposSessao.findIndex(x => x.id === t.id)
                return <tr key={t.id}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{t.id}</span>
                  </td>
                  <td className="px-4 py-3 min-w-[180px]">
                    <input value={t.nome}
                      onChange={(e) => { const c = [...tiposSessao]; c[i] = { ...c[i], nome: e.target.value }; setTiposSessao(c) }}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <input type="number" value={t.duracao_min ?? ''}
                      onChange={(e) => { const c = [...tiposSessao]; c[i] = { ...c[i], duracao_min: e.target.value ? Number(e.target.value) : null }; setTiposSessao(c) }}
                      className="w-16 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <input type="number" step="0.01" value={t.valor_fixo ?? ''} placeholder="—"
                      onChange={(e) => { const c = [...tiposSessao]; c[i] = { ...c[i], valor_fixo: e.target.value ? Number(e.target.value) : null }; setTiposSessao(c) }}
                      className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={t.conta_para_nivel}
                      onChange={(e) => { const c = [...tiposSessao]; c[i] = { ...c[i], conta_para_nivel: e.target.checked }; setTiposSessao(c) }}
                      className="w-4 h-4 rounded" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 justify-end">
                      <button onClick={() => salvarTipo(t)} disabled={saving}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        Guardar
                      </button>
                      {!TIPOS_BASE.includes(t.id) && (
                        <button onClick={() => eliminarTipo(t.id)} disabled={saving}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* NÍVEIS DE REMUNERAÇÃO */}
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-base text-gray-800">Níveis de remuneração</h2>
          <p className="text-xs text-gray-500 mt-0.5">Valor de treino_45 e treino_60 é determinado pelo nível em que estás no mês · edita e clica Guardar</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Nível</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Horas mín.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Horas máx.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Treino 45 min (€)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Treino 60 min (€)</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {niveis.map((n, i) => (
                <tr key={n.id}>
                  <td className="px-4 py-3 font-semibold text-gray-900">Nível {n.nivel}</td>
                  <td className="px-4 py-3">
                    <input type="number" value={n.horas_min}
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], horas_min: Number(e.target.value) }; setNiveis(c) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <input type="number" value={n.horas_max ?? ''} placeholder="—"
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], horas_max: e.target.value ? Number(e.target.value) : null }; setNiveis(c) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <input type="number" step="0.01" value={n.valor_45min}
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], valor_45min: Number(e.target.value) }; setNiveis(c) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <input type="number" step="0.01" value={n.valor_60min}
                      onChange={(e) => { const c = [...niveis]; c[i] = { ...c[i], valor_60min: Number(e.target.value) }; setNiveis(c) }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => salvarNivel(n)} disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      Guardar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FISCAL */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base text-gray-800">Configuração fiscal</h2>
        {fiscal && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Taxa IRS — retenção na fonte</label>
                <div className="flex items-center gap-3">
                  <input type="number" step="0.001" min="0" max="1"
                    value={fiscal.taxa_irs}
                    onChange={(e) => setFiscal({ ...fiscal, taxa_irs: Number(e.target.value) })}
                    className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-lg font-bold text-gray-900">= {(fiscal.taxa_irs * 100).toFixed(1)}%</span>
                </div>
              </div>
              <button onClick={salvarFiscal} disabled={saving || !fiscal}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors self-end">
                Guardar
              </button>
            </div>
            <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 space-y-1">
              <p>• IRS: o ginásio retém na fonte. Código 1519 (recibo verde).</p>
              <p>• SS: rendimento relevante = faturação do trimestre anterior ÷ 3 × 21,4%.</p>
              <p>• IVA: isento — o ginásio paga o IVA já incluído no valor recebido.</p>
            </div>
          </div>
        )}
      </section>

      {/* SS TRIMESTRAL */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base text-gray-800">Segurança Social trimestral</h2>
          <div className="flex gap-2">
            <button onClick={calcularSsAutomatico}
              className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors">
              Calcular trimestre anterior
            </button>
            <button onClick={addSs}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
              + Manual
            </button>
          </div>
        </div>
        {ss.length === 0
          ? <p className="text-sm text-gray-400 py-2">Nenhum registo. Adiciona no fim de cada trimestre.</p>
          : (
            <div className="space-y-2">
              {ss.map((s, i) => (
                <div key={s.id || i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Trimestre ref.</label>
                      <input type="number" min="1" max="4" value={s.trimestre_referencia}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], trimestre_referencia: Number(e.target.value) }; setSs(c) }}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Ano ref.</label>
                      <input type="number" value={s.ano_referencia}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], ano_referencia: Number(e.target.value) }; setSs(c) }}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Faturação trimestre (€)</label>
                      <input type="number" step="0.01" value={s.rendimento_relevante}
                        onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], rendimento_relevante: Number(e.target.value) }; setSs(c) }}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      {s.contribuicao_mensal > 0 && (
                        <>
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">SS mensal calculado</label>
                          <p className="text-lg font-bold text-red-500 py-2">{s.contribuicao_mensal.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-gray-500">Aplica em T</span>
                    <input type="number" min="1" max="4" value={s.trimestre_aplicacao}
                      onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], trimestre_aplicacao: Number(e.target.value) }; setSs(c) }}
                      className="w-14 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="number" value={s.ano_aplicacao}
                      onChange={(e) => { const c = [...ss]; c[i] = { ...c[i], ano_aplicacao: Number(e.target.value) }; setSs(c) }}
                      className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={() => salvarSs(s)} disabled={saving}
                      className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      Guardar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* BÓNUS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base text-gray-800">Regras de bónus trimestral</h2>
            <p className="text-xs text-gray-500 mt-0.5">Define as horas mínimas e o valor. A app calcula automaticamente se atingiste o bónus em cada trimestre.</p>
          </div>
          <button onClick={addConfigBonus}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
            + Regra
          </button>
        </div>
        {configBonus.length === 0
          ? <p className="text-sm text-gray-400 py-2">Nenhuma regra configurada. Clica em "+ Regra" para adicionar.</p>
          : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Horas mínimas / trimestre</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor do bónus (€)</th>
                    <th className="px-4 py-3 w-36"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {configBonus.map((cb, i) => (
                    <tr key={cb.id || `new-${i}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" value={cb.horas_threshold}
                            onChange={(e) => { const c = [...configBonus]; c[i] = { ...c[i], horas_threshold: Number(e.target.value) }; setConfigBonus(c) }}
                            className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <span className="text-sm text-gray-500">horas</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.01" min="0" value={cb.valor_bonus}
                            onChange={(e) => { const c = [...configBonus]; c[i] = { ...c[i], valor_bonus: Number(e.target.value) }; setConfigBonus(c) }}
                            className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <span className="text-sm text-gray-500">€</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => salvarConfigBonus(cb)} disabled={saving}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            Guardar
                          </button>
                          {cb.id > 0 && (
                            <button onClick={() => eliminarConfigBonus(cb.id)} disabled={saving}
                              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  )
}
