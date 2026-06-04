import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, key)

export type TipoAluno = 'rep' | 'oi' | 'treino_oferta'
export type TipoSessao = 'rep' | 'oi' | 'treino_oferta' | 'treino_60' | 'treino_45'
export type EstadoTarefa = 'pendente' | 'realizado' | 'nao_realizado' | 'adiado'
export type UrgenciaTarefa = 'atrasada' | 'hoje' | 'esta_semana' | 'futura'
export type EstadoBriefing = 'aberto' | 'fechado' | 'recibo_passado' | 'recebido'

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
  criado_em: string
  atualizado_em: string
}

export interface TarefaFollowup {
  id: string
  num_socio: string
  contacto: string
  tipo: 'd7' | 'd30' | 'd60' | 'd120'
  data_prevista: string
  estado: EstadoTarefa
  mensagem: string | null
  calendar_event_id: string | null
  criado_em: string
}

export interface TarefaHoje {
  id: string
  tipo: 'd7' | 'd30' | 'd60' | 'd120'
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
  valor_45min: number
  valor_60min: number
}

export interface Sessao {
  id: string
  aluno_num_socio: string
  aluno_contacto: string
  aluno_nome: string
  tipo_sessao: TipoSessao
  data_sessao: string
  valor_calculado: number
  conta_horas: boolean
  mes: string
}

export interface Briefing {
  id: string
  mes: string
  estado: EstadoBriefing
  bruto: number
  irs: number
  ss: number
  bonus: number
  liquido: number
}

export interface ConfigFiscal {
  id: number
  taxa_irs: number
}

export interface SsTrimestral {
  id: string
  trimestre: string
  rendimento_relevante: number
  base_mensal: number
  ss_mensal: number
}

export interface BonusTrimestral {
  id: string
  trimestre: string
  threshold_horas: number
  valor_bonus: number
  horas_realizadas: number
  atingido: boolean
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
