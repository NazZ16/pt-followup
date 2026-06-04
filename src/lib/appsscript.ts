const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL

export async function confirmarPlanoViaScript(params: {
  num_socio: string
  contacto: string
  nome: string
  tipo: string
  data_confirmacao: string
}): Promise<boolean> {
  if (!APPS_SCRIPT_URL) return false
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ acao: 'confirmar_plano', ...params }),
    })
    const json = await res.json()
    return json.ok === true
  } catch {
    return false
  }
}

export async function marcarTarefaViaScript(params: {
  tarefa_id: string
  estado: string
  calendar_event_id: string | null
}): Promise<boolean> {
  if (!APPS_SCRIPT_URL) return false
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ acao: 'marcar_tarefa', ...params }),
    })
    const json = await res.json()
    return json.ok === true
  } catch {
    return false
  }
}

export function appsScriptConfigurado(): boolean {
  return !!APPS_SCRIPT_URL
}
