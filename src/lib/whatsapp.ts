import { TipoAluno, TipoFollowup } from './supabase'

const DIAS: Record<TipoFollowup, number> = { '7d': 7, '30d': 30, '60d': 60, '120d': 120 }

function formatPhone(contacto: string): string {
  const digits = contacto.replace(/\D/g, '')
  if (digits.startsWith('351')) return digits
  if (digits.startsWith('9') && digits.length === 9) return `351${digits}`
  return digits
}

const MENSAGENS: Record<TipoAluno, Record<TipoFollowup, (nome: string) => string>> = {
  rep: {
    '7d':   (n) => `Olá ${n}! 👋 Já passaram 7 dias desde que ficou com o plano de treino. Como está a correr? Está a conseguir seguir as indicações?`,
    '30d':  (n) => `Olá ${n}! Já passou um mês desde a avaliação. Como se está a sentir com o plano? Alguma dúvida ou ajuste que queira fazer?`,
    '60d':  (n) => `Olá ${n}! Dois meses a trabalhar no plano — como está a correr a evolução? Gostava de saber como se sente.`,
    '120d': (n) => `Olá ${n}! Já passaram 4 meses desde a sua avaliação. Está na altura de fazer uma nova avaliação e ver a sua evolução! Quando é que lhe dá jeito?`,
  },
  oi: {
    '7d':   (n) => `Olá ${n}! 👋 Já passaram 7 dias desde que ficou com o plano. Como está a correr? Está a conseguir seguir as indicações?`,
    '30d':  (n) => `Olá ${n}! Já passou um mês. Como se está a sentir com o plano de treino? Alguma dúvida?`,
    '60d':  (n) => `Olá ${n}! Dois meses de treino — como está a evoluir? Estou aqui para ajudar com qualquer ajuste.`,
    '120d': (n) => `Olá ${n}! Já passaram 4 meses desde a sua avaliação. Está na altura de marcar uma nova! Quando é que lhe dá jeito?`,
  },
  treino_oferta: {
    '7d':   (n) => `Olá ${n}! 👋 Espero que tenha gostado do treino! Como se sentiu? Gostava de perceber se está a pensar continuar com treino personalizado.`,
    '30d':  (n) => `Olá ${n}! Já passou um mês desde o seu treino experimental. Tem pensado em começar um plano de personal training? Posso explicar-lhe como funciona e as opções disponíveis.`,
    '60d':  (n) => `Olá ${n}! Como está a correr o treino? Se quiser elevar os resultados com um programa personalizado, estou disponível para conversar. Temos opções para todos os objectivos! 💪`,
    '120d': (n) => `Olá ${n}! Há 4 meses que fez o seu treino experimental connosco. Gostava de voltar a fazer uma avaliação e ver onde pode chegar com um plano personalizado?`,
  },
}

export function gerarMensagem(nome: string, tipo: TipoAluno, marco: TipoFollowup): string {
  return MENSAGENS[tipo][marco](nome)
}

export function gerarMensagemLembrete(nome: string, hora: string | null): string {
  const horaStr = hora ? ` às ${hora}` : ''
  return `Olá ${nome}! 👋 Só a lembrar que amanhã${horaStr} tem avaliação comigo. Até amanhã! 💪`
}

export function gerarLinkWhatsApp(contacto: string, mensagem: string): string {
  const phone = formatPhone(contacto)
  return `https://wa.me/${phone}?text=${encodeURIComponent(mensagem)}`
}
