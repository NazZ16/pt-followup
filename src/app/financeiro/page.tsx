'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase, Briefing, Sessao, SsTrimestral, BonusTrimestral, EstadoBriefing, Aluno, TipoSessaoRow, ConfigBonus, ServicoPT } from '@/lib/supabase'

function fmt(v: number | null) {
  if (v == null) return '—'
  return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

const ESTADO_LABEL: Record<EstadoBriefing, string> = {
  aberto: 'Aberto', fechado: 'Fechado', recibo_passado: 'Recibo passado', recebido: 'Recebido',
}
const ESTADO_COLOR: Record<EstadoBriefing, string> = {
  aberto: 'bg-amber-100 text-amber-700',
  fechado: 'bg-blue-100 text-blue-700',
  recibo_passado: 'bg-purple-100 text-purple-700',
  recebido: 'bg-emerald-100 text-emerald-700',
}
const ESTADOS_SEGUINTES: Record<EstadoBriefing, EstadoBriefing | null> = {
  aberto: 'fechado', fechado: 'recibo_passado', recibo_passado: 'recebido', recebido: null,
}
const ESTADOS_ANTERIORES: Partial<Record<EstadoBriefing, EstadoBriefing>> = {
  fechado: 'aberto', recibo_passado: 'fechado', recebido: 'recibo_passado',
}
const ESTADO_ACAO: Partial<Record<EstadoBriefing, string>> = {
  aberto: 'Fechar mês', fechado: 'Recibo passado', recibo_passado: 'Marcar recebido',
}
const ESTADO_ACAO_VOLTAR: Partial<Record<EstadoBriefing, string>> = {
  fechado: 'Reabrir', recibo_passado: 'Voltar a fechado', recebido: 'Voltar a recibo passado',
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
  const [configBonus, setConfigBonus] = useState<ConfigBonus[]>([])
  const [alunos, setAlunos] = useState<Aluno[]>([])
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoRow[]>([])
  const [servicosPT, setServicosPT] = useState<ServicoPT[]>([])
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
    const [{ data: br }, { data: se }, { data: ssd }, { data: bon }, { data: cf }, { data: ssAtual }, { data: al }, { data: ts }, { data: cb }, { data: sp }] = await Promise.all([
      supabase.from('briefings').select('*').order('id', { ascending: false }),
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }).limit(5000),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }),
      supabase.from('bonus_trimestral').select('*').order('ano', { ascending: false }),
      supabase.from('config_fiscal').select('*').order('vigente_desde', { ascending: false }).limit(1).single(),
      supabase.from('ss_trimestral').select('*').order('ano_referencia', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('alunos').select('*').order('nome'),
      supabase.from('tipos_sessao').select('*').order('id'),
      supabase.from('config_bonus').select('*').order('horas_threshold'),
      supabase.from('servicos_pt').select('*').order('nome'),
    ])
    setBriefings((br as Briefing[]) || [])
    setSessoes((se as Sessao[]) || [])
    setSs((ssd as SsTrimestral[]) || [])
    setBonus((bon as BonusTrimestral[]) || [])
    setAlunos((al as Aluno[]) || [])
    setTiposSessao((ts as TipoSessaoRow[]) || [])
    setConfigBonus((cb as ConfigBonus[]) || [])
    setServicosPT((sp as ServicoPT[]) || [])
    if (cf) setTaxaIrs((cf as { taxa_irs: number }).taxa_irs)
    if (ssAtual) setSsMensal((ssAtual as SsTrimestral).contribuicao_mensal)
    setLoading(false)
  }

  async function recuarEstado(briefing: Briefing) {
    const anterior = ESTADOS_ANTERIORES[briefing.estado]
    if (!anterior) return
    await supabase.from('briefings').update({ estado: anterior }).eq('id', briefing.id)
    load()
  }

  async function avancarEstado(briefing: Briefing) {
    const seguinte = ESTADOS_SEGUINTES[briefing.estado]
    if (!seguinte) return
    if (briefing.estado === 'aberto') {
      const sessoesDoMes = sessoes.filter(s => s.mes_briefing === briefing.id && s.estado === 'realizada')
      const bruto = sessoesDoMes.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0)
      // Horas = planos vendidos este mês (não sessões reais)
      const horas = horasPlanoMensal
      const irs = bruto * taxaIrs
      const liquido = bruto - irs - ssMensal
      const trim = Math.ceil(briefing.mes / 3)
      // Último mês do trimestre — calcular bónus com horas de plano do trimestre
      if (briefing.mes % 3 === 0 && configBonus.length > 0) {
        // Soma horas_contadas dos briefings fechados do mesmo trimestre + mês actual
        const mesesDoTrim = [1, 2, 3].map(i => {
          const m = (trim - 1) * 3 + i
          return `${briefing.ano}-${String(m).padStart(2, '0')}`
        })
        const horasTrim = Math.round(
          mesesDoTrim.reduce((acc, mes) => {
            if (mes === briefing.id) return acc + horasPlanoMensal
            const br = briefings.find(b => b.id === mes)
            return acc + (br?.horas_contadas || 0)
          }, 0) * 100
        ) / 100
        // Regra com maior threshold atingido
        const regraAtingida = [...configBonus]
          .sort((a, b) => b.horas_threshold - a.horas_threshold)
          .find(cb => horasTrim >= cb.horas_threshold && (cb.horas_max == null || horasTrim <= cb.horas_max))
        const existente = bonus.find(b => b.ano === briefing.ano && b.trimestre === trim)
        if (existente) {
          await supabase.from('bonus_trimestral').update({
            horas_realizadas: horasTrim,
            horas_threshold: regraAtingida?.horas_threshold ?? existente.horas_threshold,
            valor_bonus: regraAtingida?.valor_bonus ?? existente.valor_bonus,
            atingido: !!regraAtingida,
          }).eq('id', existente.id)
        } else {
          const melhorRegra = regraAtingida ?? configBonus[0]
          await supabase.from('bonus_trimestral').insert({
            ano: briefing.ano, trimestre: trim,
            horas_threshold: melhorRegra.horas_threshold,
            valor_bonus: melhorRegra.valor_bonus,
            horas_realizadas: horasTrim,
            atingido: !!regraAtingida,
          })
        }
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

  async function sincronizarBriefingsAbertos(sessoesAtuais: Sessao[], _tiposAtuais: TipoSessaoRow[], briefingsAtuais: Briefing[]) {
    const abertos = briefingsAtuais.filter(b => b.estado === 'aberto')
    for (const b of abertos) {
      const sessoesDoMes = sessoesAtuais.filter(s => s.mes_briefing === b.id && s.estado === 'realizada')
      const bruto = Math.round(sessoesDoMes.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0) * 100) / 100
      const irs = Math.round(bruto * taxaIrs * 100) / 100
      const liquido = Math.round((bruto - irs - ssMensal) * 100) / 100
      // horas = planos vendidos (não sessões reais)
      await supabase.from('briefings').update({ total_bruto: bruto, irs_retido: irs, ss_pagar: ssMensal, liquido, horas_contadas: horasPlanoMensal }).eq('id', b.id)
    }
  }

  async function eliminarSessao(id: string) {
    await supabase.from('sessoes').delete().eq('id', id)
    const [{ data: se }, { data: brFrescos }] = await Promise.all([
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }),
      supabase.from('briefings').select('*').order('id', { ascending: false }),
    ])
    const sessoesAtuais = (se as Sessao[]) || []
    await sincronizarBriefingsAbertos(sessoesAtuais, tiposSessao, (brFrescos as Briefing[]) || [])
    load()
  }

  async function toggleEstadoSessao(sessao: Sessao) {
    const novoEstado = sessao.estado === 'realizada' ? 'nao_realizada' : 'realizada'
    await supabase.from('sessoes').update({ estado: novoEstado }).eq('id', sessao.id)
    const [{ data: se }, { data: brFrescos }] = await Promise.all([
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }),
      supabase.from('briefings').select('*').order('id', { ascending: false }),
    ])
    const sessoesAtuais = (se as Sessao[]) || []
    await sincronizarBriefingsAbertos(sessoesAtuais, tiposSessao, (brFrescos as Briefing[]) || [])
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

  async function recalcularSessoesBriefing(briefingId: string) {
    const { data: niveisData } = await supabase.from('niveis_remuneracao').select('*').order('horas_min')
    const niveis = (niveisData || []) as { horas_min: number; horas_max: number | null; valor_45min: number; valor_60min: number }[]
    const repTipo = tiposSessao.find(t => t.id === 'rep')

    // Buscar sessões directamente da BD (estado mais fresco)
    const { data: sesData } = await supabase
      .from('sessoes').select('*')
      .eq('mes_briefing', briefingId).eq('estado', 'realizada')
      .order('data_sessao')
    const sessoesDoMes = (sesData as Sessao[]) || []

    // Nivel fixo para o mês — determinado pelas horas totais de planos vendidos
    const nivelDoMes = niveis
      .filter(n => horasPlanoMensal >= n.horas_min && (n.horas_max == null || horasPlanoMensal < n.horas_max))
      .pop()

    let atualizadas = 0
    for (const s of sessoesDoMes) {
      // Buscar aluno por num_socio (contacto pode diferir ligeiramente)
      const aluno = alunos.find(a => a.num_socio === s.num_socio && a.contacto === s.contacto)
              ?? alunos.find(a => a.num_socio === s.num_socio)
      const tipo = tiposSessao.find(t => t.id === s.tipo_sessao_id)
      const contaHoras = !!aluno?.convertido && !!tipo?.conta_para_nivel

      let valorCalculado: number | null = s.valor_calculado

      if (s.num_socio === 'MI' || tipo?.id === 'mi') {
        const valorRep = repTipo?.valor_fixo ?? 0
        const duracaoMin = tipo?.duracao_min ?? 60
        valorCalculado = valorRep * Math.ceil(duracaoMin / 60)
      } else if (tipo?.categoria === 'avaliacao') {
        valorCalculado = tipo.valor_fixo ?? 0
      } else if (tipo?.categoria === 'treino' && aluno?.convertido && nivelDoMes) {
        // Valor = taxa do nivel actual para a duração do treino
        valorCalculado = (tipo.duracao_min ?? 60) <= 45 ? nivelDoMes.valor_45min : nivelDoMes.valor_60min
      }

      await supabase.from('sessoes').update({ valor_calculado: valorCalculado, conta_horas: contaHoras }).eq('id', s.id)
      atualizadas++
    }

    // Sync o briefing com os novos valores
    const { data: seFrescos } = await supabase.from('sessoes').select('*').order('data_sessao', { ascending: false })
    const { data: brFrescos } = await supabase.from('briefings').select('*').order('id', { ascending: false })
    await sincronizarBriefingsAbertos((seFrescos as Sessao[]) || [], tiposSessao, (brFrescos as Briefing[]) || [])

    console.log(`Recalcular ${briefingId}: ${atualizadas} sessões actualizadas`)
    load()
  }

  async function corrigirMesBriefing() {
    // Corrige sessões com mes_briefing null ou incorreto com base em data_sessao
    const sessoesParaCorrigir = sessoes.filter(s => {
      if (!s.data_sessao) return false
      const mes = s.data_sessao.slice(0, 7)
      return !s.mes_briefing || s.mes_briefing !== mes
    })
    if (sessoesParaCorrigir.length === 0) { alert('Nenhuma sessão a corrigir.'); return }
    for (const s of sessoesParaCorrigir) {
      const mes = s.data_sessao.slice(0, 7)
      await supabase.from('sessoes').update({ mes_briefing: mes }).eq('id', s.id)
    }
    alert(`${sessoesParaCorrigir.length} sessões corrigidas.`)
    load()
  }

  async function registarSessao() {
    if (!formSessao.num_socio || !formSessao.tipo_sessao_id || !formSessao.data_sessao) return
    setSaving(true)
    const aluno = alunos.find(a => a.num_socio === formSessao.num_socio && a.contacto === formSessao.contacto)
    const tipo = tiposSessao.find(t => t.id === formSessao.tipo_sessao_id)
    const d = new Date(formSessao.data_sessao + 'T12:00:00')
    const mesBriefing = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const { data: brExistente } = await supabase.from('briefings').select('id').eq('id', mesBriefing).maybeSingle()
    if (!brExistente) {
      await supabase.from('briefings').insert({ id: mesBriefing, ano: d.getFullYear(), mes: d.getMonth() + 1, estado: 'aberto', total_bruto: 0, irs_retido: 0, ss_pagar: ssMensal, liquido: 0, horas_contadas: 0 })
    }

    const contaHoras = !!aluno?.convertido && !!tipo?.conta_para_nivel

    let valorCalculado: number | null = null
    if (tipo?.categoria === 'avaliacao') {
      valorCalculado = tipo.valor_fixo ?? 0
    } else if (tipo?.id === 'mi') {
      // MI: valor igual ao de rep, por hora (meia hora conta como 1 hora)
      const repTipo = tiposSessao.find(t => t.id === 'rep')
      const valorRep = repTipo?.valor_fixo ?? 0
      const horas = Math.ceil((tipo.duracao_min ?? 60) / 60)
      valorCalculado = valorRep * horas
    } else if (tipo?.categoria === 'treino' && aluno?.convertido) {
      const { data: niveisData } = await supabase.from('niveis_remuneracao').select('*').order('horas_min')
      // Nivel determinado pelas horas totais de planos vendidos (não sessões reais)
      const nivel = ((niveisData || []) as { horas_min: number; horas_max: number | null; valor_45min: number; valor_60min: number }[])
        .filter(n => horasPlanoMensal >= n.horas_min && (n.horas_max == null || horasPlanoMensal < n.horas_max))
        .pop()
      if (nivel) valorCalculado = (tipo.duracao_min ?? 60) <= 45 ? nivel.valor_45min : nivel.valor_60min
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
    // Buscar estado fresco para sincronizar (evita stale closure em briefings)
    const [{ data: se }, { data: brFrescos }] = await Promise.all([
      supabase.from('sessoes').select('*').order('data_sessao', { ascending: false }),
      supabase.from('briefings').select('*').order('id', { ascending: false }),
    ])
    const sessoesAtuais = (se as Sessao[]) || []
    const briefingsFrescos = (brFrescos as Briefing[]) || []
    await sincronizarBriefingsAbertos(sessoesAtuais, tiposSessao, briefingsFrescos)
    setNovasSessao(false)
    setSaving(false)
    load()
  }

  // Horas mensais dos planos vendidos (alunos PT activos)
  const horasPlanoMensal = useMemo(() => {
    return Math.round(
      alunos
        .filter(a => a.convertido && a.estado === 'ativo' && a.conta_horas_plano !== false)
        .reduce((acc, a) => {
          const sv = servicosPT.find(s => s.nome === a.plano_pt)
          if (sv) {
            const dur = (sv.duracao_min ?? 60) / 60
            const sessoesSemana = sv.sessoes_semana || 1
            const mult = sv.tipo === 'semanal' ? 4.33 : 1
            return acc + sessoesSemana * mult * dur
          }
          return acc + (a.horas_pt_mensais || 0)
        }, 0) * 100
    ) / 100
  }, [alunos, servicosPT])

  // Progresso bónus trimestre atual — horas = planos vendidos por mês com briefing
  const hoje = new Date()
  const trimAtual = Math.ceil((hoje.getMonth() + 1) / 3)
  const anoAtual = hoje.getFullYear()
  const mesInicio = (trimAtual - 1) * 3 + 1
  const mesesTrim = [mesInicio, mesInicio + 1, mesInicio + 2].map(m => `${anoAtual}-${String(m).padStart(2, '0')}`)
  const horasTrimAtual = Math.round(
    mesesTrim.reduce((acc, mes) => {
      const br = briefings.find(b => b.id === mes)
      if (!br) return acc
      // Briefing fechado: usar horas_contadas gravadas; aberto: usar plano actual
      return acc + (br.estado !== 'aberto' ? (br.horas_contadas || 0) : horasPlanoMensal)
    }, 0) * 10
  ) / 10
  const melhorRegraAtingida = [...configBonus]
    .sort((a, b) => b.horas_threshold - a.horas_threshold)
    .find(cb => horasTrimAtual >= cb.horas_threshold && (cb.horas_max == null || horasTrimAtual <= cb.horas_max))
  const proximaRegra = [...configBonus]
    .sort((a, b) => a.horas_threshold - b.horas_threshold)
    .find(cb => horasTrimAtual < cb.horas_threshold)

  const sessoesByMes = sessoes.reduce<Record<string, Sessao[]>>((acc, s) => {
    if (!s.mes_briefing) return acc
    if (!acc[s.mes_briefing]) acc[s.mes_briefing] = []
    acc[s.mes_briefing].push(s)
    return acc
  }, {})

  // Valores ao vivo para briefings abertos
  // bruto = soma dos valor_calculado das sessões; horas = plano mensal vendido
  const liveValores = useMemo(() => {
    const map: Record<string, { bruto: number; horas: number; irs: number; liquido: number }> = {}
    for (const b of briefings) {
      if (b.estado !== 'aberto') continue
      const sessoesDoMes = sessoes.filter(s => s.mes_briefing === b.id && s.estado === 'realizada')
      const bruto = Math.round(sessoesDoMes.reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0) * 100) / 100
      const irs = Math.round(bruto * taxaIrs * 100) / 100
      const liquido = Math.round((bruto - irs - ssMensal) * 100) / 100
      map[b.id] = { bruto, horas: horasPlanoMensal, irs, liquido }
    }
    return map
  }, [briefings, sessoes, horasPlanoMensal, taxaIrs, ssMensal])

  const alunoSelecionado = alunos.find(a => a.num_socio === formSessao.num_socio && a.contacto === formSessao.contacto)

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <p className="text-gray-400 text-sm">A carregar...</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>
        <div className="flex gap-2">
          <button onClick={() => setNovasSessao(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 transition-colors shadow-sm">
            + Sessão
          </button>
          <button onClick={criarBriefingMesCorrente}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm">
            + Briefing
          </button>
        </div>
      </div>

      {/* FORM NOVA SESSÃO */}
      {novasSessao && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-3">
          <h2 className="font-semibold">Registar sessão</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Aluno</label>
              <select value={`${formSessao.num_socio}|${formSessao.contacto}`}
                onChange={(e) => {
                  const [num_socio, contacto] = e.target.value.split('|')
                  const aluno = alunos.find(a => a.num_socio === num_socio && a.contacto === contacto)
                  let tipo_sessao_id = formSessao.tipo_sessao_id
                  if (aluno?.plano_pt) {
                    const sv = servicosPT.find(s => s.nome === aluno.plano_pt)
                    if (sv?.duracao_min) {
                      const match = tiposSessao.find(t => t.categoria === 'treino' && t.duracao_min === sv.duracao_min)
                      if (match) tipo_sessao_id = match.id
                      else tipo_sessao_id = sv.duracao_min <= 45 ? 'treino_45' : 'treino_60'
                    }
                  }
                  setFormSessao({ ...formSessao, num_socio, contacto, tipo_sessao_id })
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="|">Seleccionar aluno...</option>
                {alunos.map(a => <option key={`${a.num_socio}-${a.contacto}`} value={`${a.num_socio}|${a.contacto}`}>{a.nome} ({a.num_socio})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Tipo de sessão</label>
              <select value={formSessao.tipo_sessao_id}
                onChange={(e) => setFormSessao({ ...formSessao, tipo_sessao_id: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Seleccionar...</option>
                {tiposSessao.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Data</label>
              <input type="date" value={formSessao.data_sessao}
                onChange={(e) => setFormSessao({ ...formSessao, data_sessao: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {alunoSelecionado && (
              <p className="col-span-2 text-sm text-gray-500">
                {alunoSelecionado.convertido ? '✓ PT activo — conta para nível' : '✗ Não PT — não conta para nível'}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={registarSessao} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Guardar
            </button>
            <button onClick={() => setNovasSessao(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* BÓNUS TRIMESTRE ATUAL */}
      {configBonus.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🏆 Bónus — T{trimAtual} {anoAtual}</p>
          <div className={`bg-white rounded-xl shadow-sm border p-3 space-y-2 ${melhorRegraAtingida ? 'border-emerald-200' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">{horasTrimAtual}h realizadas este trimestre</span>
              {melhorRegraAtingida
                ? <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-700">✓ Bónus de {melhorRegraAtingida.valor_bonus.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })} atingido</span>
                : proximaRegra
                  ? <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-amber-100 text-amber-700">Faltam {(proximaRegra.horas_threshold - horasTrimAtual).toFixed(1)}h para {proximaRegra.valor_bonus.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}</span>
                  : null
              }
            </div>
            {proximaRegra && (
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${melhorRegraAtingida ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${Math.min(100, (horasTrimAtual / proximaRegra.horas_threshold) * 100)}%` }}
                />
              </div>
            )}
            <div className="flex gap-4">
              {configBonus.map(cb => (
                <div key={cb.id} className="text-xs text-gray-500">
                  <span className={horasTrimAtual >= cb.horas_threshold ? 'text-emerald-600 font-semibold' : ''}>
                    {cb.horas_threshold}h → {cb.valor_bonus.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}
                    {horasTrimAtual >= cb.horas_threshold ? ' ✓' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* BRIEFINGS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base text-gray-800">Briefings mensais</h2>
          <button onClick={corrigirMesBriefing} className="text-xs text-gray-400 hover:text-gray-600 underline">
            Corrigir atribuição de sessões
          </button>
        </div>
        {briefings.length === 0
          ? <p className="text-sm text-gray-400 py-2">Nenhum briefing criado ainda.</p>
          : (
            <div className="space-y-3">
              {briefings.map((b) => (
                <div key={b.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-lg text-gray-900">{b.id}</span>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ESTADO_COLOR[b.estado]}`}>{ESTADO_LABEL[b.estado]}</span>
                      </div>
                      <div className="flex gap-2">
                        {ESTADOS_ANTERIORES[b.estado] && (
                          <button onClick={() => recuarEstado(b)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                            ↩ {ESTADO_ACAO_VOLTAR[b.estado]}
                          </button>
                        )}
                        {ESTADOS_SEGUINTES[b.estado] && (
                          <button onClick={() => avancarEstado(b)}
                            className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors">
                            {ESTADO_ACAO[b.estado]}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-3">
                      {(() => {
                        const live = liveValores[b.id]
                        const bruto = live ? live.bruto : b.total_bruto
                        const irs = live ? live.irs : b.irs_retido
                        const ss = b.ss_pagar
                        const liquido = live ? live.liquido : b.liquido
                        const horas = live ? live.horas : b.horas_contadas
                        return <>
                          <FinRow label={`Bruto${live ? ' ●' : ''}`} value={fmt(bruto)} />
                          <FinRow label={`IRS ${(taxaIrs * 100).toFixed(1)}%`} value={`-${fmt(irs)}`} negative />
                          <FinRow label="SS" value={`-${fmt(ss)}`} negative />
                          <FinRow label="Líquido" value={fmt(liquido)} highlight />
                          <FinRow label={`Horas${live ? ' ●' : ''}`} value={horas != null ? `${horas}h` : '—'} />
                        </>
                      })()}
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <button onClick={() => setMesSelecionado(mesSelecionado === b.id ? null : b.id)}
                        className="text-sm text-blue-600 font-medium hover:underline">
                        {mesSelecionado === b.id ? 'Ocultar sessões' : `Ver sessões (${sessoesByMes[b.id]?.length ?? 0})`}
                      </button>
                      {b.estado === 'aberto' && (
                        <button onClick={() => recalcularSessoesBriefing(b.id)}
                          className="text-sm text-amber-600 font-medium hover:underline">
                          ↻ Recalcular valores
                        </button>
                      )}
                    </div>
                  </div>

                  {mesSelecionado === b.id && (() => {
                    const todasSessoes = sessoesByMes[b.id] || []
                    const GRUPOS: { label: string; ids: string[] }[] = [
                      { label: 'Treinos PT', ids: ['treino_60', 'treino_45', 'treino_30'] },
                      { label: 'Rep / Avaliação', ids: ['rep', 'sw'] },
                      { label: 'OI', ids: ['oi'] },
                      { label: 'Treino Oferta', ids: ['treino_oferta'] },
                      { label: 'Natação', ids: ['n1','n2','n3','n4','n5','n6','n1f','n2f','n3f','n4f','n5f','n6f'] },
                      { label: 'Sala (MI)', ids: ['mi'] },
                    ]
                    const renderSessao = (s: Sessao) => {
                      const naoRealizada = s.estado !== 'realizada'
                      const nomeAluno = s.num_socio ? (alunos.find(a => a.num_socio === s.num_socio && a.contacto === s.contacto)?.nome ?? s.num_socio) : null
                      const tipoNome = tiposSessao.find(t => t.id === s.tipo_sessao_id)?.nome ?? s.tipo_sessao_id
                      return (
                        <div key={s.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${naoRealizada ? 'bg-red-50 text-gray-400' : 'bg-white border border-gray-100 text-gray-700'}`}>
                          <span className={`flex-1 text-sm ${naoRealizada ? 'line-through' : ''}`}>
                            {s.data_sessao}{nomeAluno ? ` · ${nomeAluno}` : ''}{nomeAluno ? ` · ${tipoNome}` : ` · ${tipoNome}`}
                            {s.conta_horas && <span className="ml-1 text-xs text-blue-600 font-medium">⏱</span>}
                          </span>
                          <span className="font-semibold text-sm">{fmt(s.valor_calculado)}</span>
                          <button onClick={() => toggleEstadoSessao(s)} title={naoRealizada ? 'Marcar realizada' : 'Marcar não realizada'}
                            className="text-gray-400 hover:text-amber-600 transition-colors text-lg leading-none">
                            {naoRealizada ? '↩' : '✕'}
                          </button>
                          <button onClick={() => eliminarSessao(s.id)} title="Eliminar"
                            className="text-gray-400 hover:text-red-500 transition-colors">
                            🗑
                          </button>
                        </div>
                      )
                    }
                    const restantes = new Set(todasSessoes.map(s => s.id))
                    const gruposComSessoes = GRUPOS.map(g => {
                      const ss = todasSessoes.filter(s => g.ids.includes(s.tipo_sessao_id))
                      ss.forEach(s => restantes.delete(s.id))
                      return { ...g, sessoes: ss }
                    }).filter(g => g.sessoes.length > 0)
                    const outras = todasSessoes.filter(s => restantes.has(s.id))
                    if (outras.length > 0) gruposComSessoes.push({ label: 'Outros', ids: [], sessoes: outras })
                    return (
                      <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-3">
                        {todasSessoes.length === 0
                          ? <p className="text-sm text-gray-400 py-1">Sem sessões registadas.</p>
                          : gruposComSessoes.map(g => {
                            const totalGrupo = g.sessoes.filter(s => s.estado === 'realizada').reduce((acc, s) => acc + (s.valor_calculado ?? 0), 0)
                            return (
                              <div key={g.label}>
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{g.label} ({g.sessoes.length})</p>
                                  {totalGrupo > 0 && <p className="text-xs font-bold text-emerald-700">{fmt(totalGrupo)}</p>}
                                </div>
                                <div className="space-y-1">{g.sessoes.map(renderSessao)}</div>
                              </div>
                            )
                          })
                        }
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
      </section>

      {/* SS TRIMESTRAL */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base text-gray-800">Segurança Social trimestral</h2>
        {ss.length === 0
          ? <p className="text-sm text-gray-400 py-2">Sem registos. Configura em <a href="/config" className="text-blue-600 hover:underline">Config</a>.</p>
          : (
            <div className="space-y-2">
              {ss.map((s) => (
                <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 grid grid-cols-3 gap-3">
                  <FinRow label="Referência" value={`T${s.trimestre_referencia} ${s.ano_referencia}`} />
                  <FinRow label="Base mensal" value={fmt(s.base_incidencia)} />
                  <FinRow label="SS mensal" value={fmt(s.contribuicao_mensal)} negative />
                </div>
              ))}
            </div>
          )}
      </section>

      {/* BÓNUS TRIMESTRAL */}
      <section className="space-y-3">
        <h2 className="font-semibold text-base text-gray-800">Bónus trimestral</h2>
        {bonus.length === 0
          ? <p className="text-sm text-gray-400 py-2">Sem registos. Configura em <a href="/config" className="text-blue-600 hover:underline">Config</a>.</p>
          : (
            <div className="space-y-2">
              {bonus.map((b) => (
                <div key={b.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-lg text-gray-900">T{b.trimestre} {b.ano}</span>
                    <div className="flex gap-2">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${b.atingido ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {b.atingido ? 'Atingido ✓' : 'Não atingido'}
                      </span>
                      {b.atingido && (
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${b.recebido ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {b.recebido ? 'Recebido' : 'Por receber'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FinRow label="Horas" value={`${b.horas_realizadas} / ${b.horas_threshold}h`} />
                    <FinRow label="Valor bónus" value={fmt(b.valor_bonus)} highlight={b.atingido} />
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}

function FinRow({ label, value, highlight, negative }: { label: string; value: string; highlight?: boolean; negative?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`font-semibold mt-0.5 ${highlight ? 'text-emerald-600 text-lg' : negative ? 'text-red-500' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
