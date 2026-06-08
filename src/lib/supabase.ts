import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, key)

export type TipoAluno = 'rep' | 'oi' | 'treino_oferta' | 'pt_direto'
export type TipoSessao = 'rep' | 'oi' | 'treino_oferta' | 'treino_60' | 'treino_45'
export type EstadoTarefa = 'pendente' | 'realizado' | 'nao_realizado' | 'adiado'
export type UrgenciaTarefa = 'atrasada' | 'hoje' | 'esta_semana' | 'futura'
export type EstadoBriefing = 'aberto' | 'fechado' | 'recibo_passado' | 'recebido'
export type TipoFollowup = '7d' | '30d' | '60d' | '120d'

export interface ServicoPT {
  id: number
  nome: string
  codigo: string | null
  custo: number | null
  tipo: 'semanal' | 'pack'
  sessoes_semana: number | null
  duracao_min: number | null
  horas_mensais: number
}

export interface Aluno {
  num_socio: string
  contacto: string
  nome: string
  tipo: TipoAluno
  convertido: boolean
  ultima_avaliacao: string | null
  plano_confirmado_em: string | null
  estado: string | null
  notas: string | null
  plano_pt: string | null
  horas_pt_mensais: number | null
  meses_pagos_pt: number | null
  criado_em: string
  atualizado_em: string
}

export interface TarefaFollowup {
  id: string
  num_socio: string
  contacto: string
  tipo: TipoFollowup
  data_prevista: string
  estado: EstadoTarefa
  mensagem: string | null
  calendar_event_id: string | null
  criado_em: string
}

export interface TarefaHoje {
  id: string
  tipo: TipoFollowup
  data_prevista: string
  estado: EstadoTarefa
  mensagem: string | null
  nome: string
  contacto: string
  num_socio: string
  aluno_tipo: TipoAluno
  urgencia: UrgenciaTarefa
  calendar_event_id?: string | null
}

export interface NivelRemuneracao {
  id: number
  nivel: number
  horas_min: number
  horas_max: number | null
  valor_30min: number
  valor_45min: number
  valor_60min: number
  vigente_desde: string
}

export interface TipoSessaoRow {
  id: string
  nome: string
  categoria: 'avaliacao' | 'treino'
  duracao_min: number | null
  valor_fixo: number | null
  conta_para_nivel: boolean
}

export interface Sessao {
  id: string
  num_socio: string | null
  contacto: string | null
  tipo_sessao_id: string
  data_sessao: string
  estado: string
  mes_briefing: string | null
  incluida_briefing: boolean
  valor_calculado: number | null
  conta_horas: boolean
  hora_inicio: string | null
  notas: string | null
  calendar_event_id: string | null
  criado_em: string
}

export interface Briefing {
  id: string
  ano: number
  mes: number
  nivel_aplicado: number | null
  horas_contadas: number
  total_bruto: number
  irs_retido: number
  ss_pagar: number
  liquido: number
  estado: EstadoBriefing
  data_fecho: string | null
  data_recibo: string | null
  data_recebimento_real: string | null
}

export interface ConfigFiscal {
  id: number
  taxa_irs: number
  vigente_desde: string
}

export interface SsTrimestral {
  id: number
  ano_referencia: number
  trimestre_referencia: number
  rendimento_relevante: number
  base_incidencia: number
  contribuicao_mensal: number
  ano_aplicacao: number
  trimestre_aplicacao: number
}

export interface ConfigBonus {
  id: number
  horas_threshold: number
  horas_max: number | null
  valor_bonus: number
}

export interface BonusTrimestral {
  id: number
  ano: number
  trimestre: number
  horas_threshold: number
  valor_bonus: number
  horas_realizadas: number
  atingido: boolean
  recebido: boolean
  data_recebimento: string | null
}

export interface MesCorrente {
  total_sessoes: number
  horas_nivel: number | null
  bruto_acumulado: number | null
  nivel_atual: number | null
  nivel_horas_min: number | null
  nivel_horas_max: number | null
  taxa_irs: number
  irs_estimado: number | null
  ss_mensal: number
  liquido_estimado: number | null
}
