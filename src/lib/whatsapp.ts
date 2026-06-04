import { TipoAluno } from './supabase'

const MARCOS = { d7: 7, d30: 30, d60: 60, d120: 120 }

function formatPhone(contacto: string): string {
  const digits = contacto.replace(/\D/g, '')
  if (digits.startsWith('351') || digits.startsWith('00351')) return digits.replace(/^00/, '')
  if (digits.startsWith('9') && digits.length === 9) return `351${digits}`
  return digits
}

function mensagemRepOi(nome: string, marco: keyof typeof MARCOS): string {
  const dias = MARCOS[marco]
  return `Olá ${nome}! 👋 Já passaram ${dias} dias desde a tua avaliação.\n\nComo está a correr o teu plano de treino? Tens tido alguma dificuldade? 💪`
}

function mensagemTreinoOferta(nome: string, marco: keyof typeof MARCOS): string {
  const dias = MARCOS[marco]
  if (dias <= 30) {
    return `Olá ${nome}! 😊 Já passaram ${dias} dias desde o teu treino de oferta.\n\nComo te tens sentido? Estás a treinar com regularidade?`
  }
  return `Olá ${nome}! 🏋️ Já passaram ${dias} dias desde que treinaste connosco.\n\nSentimos a tua falta! Que tal marcarmos um treino experimental para retomar o teu progresso? Temos pacotes PT com óptima relação qualidade-preço 💪`
}

export function gerarMensagem(
  nome: string,
  tipo: TipoAluno,
  marco: keyof typeof MARCOS
): string {
  if (tipo === 'treino_oferta') return mensagemTreinoOferta(nome, marco)
  return mensagemRepOi(nome, marco)
}

export function gerarLinkWhatsApp(
  contacto: string,
  mensagem: string
): string {
  const phone = formatPhone(contacto)
  const text = encodeURIComponent(mensagem)
  return `https://wa.me/${phone}?text=${text}`
}
