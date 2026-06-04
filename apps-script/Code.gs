// ============================================================
// PT FOLLOW-UP — Google Apps Script
// Liga o Google Calendar ao Supabase
// ============================================================

const SUPABASE_URL  = 'https://zvsoymtlmpnfaskjwvos.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2c295bXRsbXBuZmFza2p3dm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODM3MTYsImV4cCI6MjA5NjE1OTcxNn0.JilJkj--p_viCJxtbQYg4iO3yOvg7pSm8qOlouzeD3g';

// Prefixos que identificam eventos de alunos (minúsculas)
const PREFIXOS_ALUNOS    = ['rep', 'oi', 'treino oferta'];

// Prefixo dos eventos de follow-up criados pelo script (não processar como alunos)
const PREFIXO_FOLLOWUP   = 'followup__';

// Dias de janela para procurar eventos no Calendar (passado e futuro)
const JANELA_DIAS_ANTES  = 1;
const JANELA_DIAS_DEPOIS = 30;

// Mensagens de follow-up por tipo de aluno e momento
const MENSAGENS = {
  rep: {
    '7d':  (nome) => `Olá ${nome}! 👋 Já passaram 7 dias desde que ficou com o plano de treino. Como está a correr? Está a conseguir seguir as indicações?`,
    '30d': (nome) => `Olá ${nome}! Já passou um mês desde a avaliação. Como se está a sentir com o plano? Alguma dúvida ou ajuste que queira fazer?`,
    '60d': (nome) => `Olá ${nome}! Dois meses a trabalhar no plano — como está a correr a evolução? Gostava de saber como se sente.`,
    '120d':(nome) => `Olá ${nome}! Já passaram 4 meses desde a sua avaliação. Está na altura de fazer uma nova avaliação e ver a sua evolução! Quando é que lhe dá jeito?`,
  },
  oi: {
    '7d':  (nome) => `Olá ${nome}! 👋 Já passaram 7 dias desde que ficou com o plano. Como está a correr? Está a conseguir seguir as indicações?`,
    '30d': (nome) => `Olá ${nome}! Já passou um mês. Como se está a sentir com o plano de treino? Alguma dúvida?`,
    '60d': (nome) => `Olá ${nome}! Dois meses de treino — como está a evoluir? Estou aqui para ajudar com qualquer ajuste.`,
    '120d':(nome) => `Olá ${nome}! Já passaram 4 meses desde a sua avaliação. Está na altura de marcar uma nova! Quando é que lhe dá jeito?`,
  },
  treino_oferta: {
    '7d':  (nome) => `Olá ${nome}! 👋 Espero que tenha gostado do treino! Como se sentiu? Gostava de perceber se está a pensar continuar com treino personalizado.`,
    '30d': (nome) => `Olá ${nome}! Já passou um mês desde o seu treino experimental. Tem pensado em começar um plano de personal training? Posso explicar-lhe como funciona e as opções disponíveis.`,
    '60d': (nome) => `Olá ${nome}! Como está a correr o treino? Se quiser elevar os resultados com um programa personalizado, estou disponível para conversar. Temos opções para todos os objectivos! 💪`,
    '120d':(nome) => `Olá ${nome}! Há 4 meses que fez o seu treino experimental connosco. Gostava de voltar a fazer uma avaliação e ver onde pode chegar com um plano personalizado?`,
  },
};

// ============================================================
// FUNÇÃO PRINCIPAL — correr via trigger (a cada hora ou diária)
// ============================================================
function syncCalendarToSupabase() {
  const agora   = new Date();
  const inicio  = new Date(agora);
  inicio.setDate(inicio.getDate() - JANELA_DIAS_ANTES);
  const fim     = new Date(agora);
  fim.setDate(fim.getDate() + JANELA_DIAS_DEPOIS);

  const calendario = CalendarApp.getDefaultCalendar();
  const eventos    = calendario.getEvents(inicio, fim);

  eventos.forEach(evento => {
    const titulo = evento.getTitle().trim();

    // Ignorar eventos de follow-up criados pelo próprio script
    if (titulo.toLowerCase().startsWith(PREFIXO_FOLLOWUP)) return;

    // Tentar fazer parse do evento
    const parsed = parsearEvento(titulo, evento.getDescription());
    if (!parsed) return;

    // Upsert do aluno no Supabase
    const aluno = upsertAluno(parsed);
    if (!aluno) return;

    // Registar a sessão (se ainda não foi registada — usa event ID como idempotência)
    registarSessao(parsed, evento.getId());
  });

  Logger.log('Sync concluído: ' + new Date().toISOString());
}

// ============================================================
// PARSE DO EVENTO
// Título: "rep João Silva - 1234"  ou  "treino oferta Maria - 5678"
// Descrição: linha com o contacto (número de telefone)
// ============================================================
function parsearEvento(titulo, descricao) {
  const tituloLower = titulo.toLowerCase();

  let tipo = null;
  let restoTitulo = titulo;

  for (const prefixo of PREFIXOS_ALUNOS) {
    if (tituloLower.startsWith(prefixo + ' ')) {
      tipo = prefixo.replace(' ', '_');  // "treino oferta" → "treino_oferta"
      restoTitulo = titulo.substring(prefixo.length).trim();
      break;
    }
  }

  if (!tipo) return null;

  const sepIdx = restoTitulo.lastIndexOf(' - ');
  if (sepIdx === -1) {
    Logger.log('Evento sem número de sócio: ' + titulo);
    return null;
  }

  const nome     = restoTitulo.substring(0, sepIdx).trim();
  const numSocio = restoTitulo.substring(sepIdx + 3).trim();

  if (!nome || !numSocio) return null;

  const contacto = extrairContacto(descricao);
  if (!contacto) {
    Logger.log('Evento sem contacto na descrição: ' + titulo);
    return null;
  }

  return { tipo, nome, numSocio, contacto };
}

function extrairContacto(descricao) {
  if (!descricao) return null;
  const linhas = descricao.split('\n');
  for (const linha of linhas) {
    const limpa = linha.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (limpa.length >= 9) return limpa;
  }
  return null;
}

// ============================================================
// UPSERT ALUNO
// ============================================================
function upsertAluno(parsed) {
  const payload = {
    num_socio:        parsed.numSocio,
    contacto:         parsed.contacto,
    nome:             parsed.nome,
    tipo:             parsed.tipo,
    ultima_avaliacao: new Date().toISOString().split('T')[0],
    atualizado_em:    new Date().toISOString(),
  };

  const resp = supabaseFetch(
    '/rest/v1/alunos',
    'POST',
    payload,
    { 'Prefer': 'resolution=merge-duplicates,return=representation' }
  );

  if (!resp || resp.error) {
    Logger.log('Erro upsert aluno: ' + JSON.stringify(resp));
    return null;
  }

  return Array.isArray(resp) ? resp[0] : resp;
}

// ============================================================
// REGISTAR SESSÃO
// ============================================================
function registarSessao(parsed, eventoId) {
  const hoje = new Date();
  const dataHoje = hoje.toISOString().split('T')[0];
  const existente = supabaseFetch(
    '/rest/v1/sessoes?num_socio=eq.' + encodeURIComponent(parsed.numSocio) +
    '&contacto=eq.' + encodeURIComponent(parsed.contacto) +
    '&data_sessao=eq.' + dataHoje +
    '&tipo_sessao_id=eq.' + parsed.tipo +
    '&select=id',
    'GET'
  );

  if (existente && existente.length > 0) return;

  const mesBriefing = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');

  garantirBriefing(mesBriefing, hoje.getFullYear(), hoje.getMonth() + 1);

  const payload = {
    num_socio:         parsed.numSocio,
    contacto:          parsed.contacto,
    tipo_sessao_id:    parsed.tipo,
    data_sessao:       hoje.toISOString().split('T')[0],
    estado:            'realizada',
    mes_briefing:      mesBriefing,
    incluida_briefing: false,
    conta_horas:       false,
  };

  const resp = supabaseFetch('/rest/v1/sessoes', 'POST', payload, {
    'Prefer': 'return=minimal'
  });

  if (resp && resp.error) {
    Logger.log('Erro ao registar sessão: ' + JSON.stringify(resp));
  }
}

// ============================================================
// GARANTIR BRIEFING DO MÊS
// ============================================================
function garantirBriefing(id, ano, mes) {
  const existente = supabaseFetch(
    '/rest/v1/briefings?id=eq.' + id + '&select=id',
    'GET'
  );
  if (existente && existente.length > 0) return;

  supabaseFetch('/rest/v1/briefings', 'POST', {
    id:     id,
    ano:    ano,
    mes:    mes,
    estado: 'aberto',
  }, { 'Prefer': 'return=minimal' });
}

// ============================================================
// CRIAR EVENTOS DE FOLLOW-UP NO CALENDAR
// ============================================================
function criarFollowUps(numSocio, contacto, nome, tipo, dataConfirmacao) {
  const base     = new Date(dataConfirmacao);
  const calendar = CalendarApp.getDefaultCalendar();

  const sequencia = [
    { dias: 7,   chave: '7d'   },
    { dias: 30,  chave: '30d'  },
    { dias: 60,  chave: '60d'  },
    { dias: 120, chave: '120d' },
  ];

  sequencia.forEach(({ dias, chave }) => {
    const dataEvento = new Date(base);
    dataEvento.setDate(dataEvento.getDate() + dias);

    const mensagemFn = (MENSAGENS[tipo] || MENSAGENS['rep'])[chave];
    const mensagem   = mensagemFn(nome);

    const tituloEvento = `${PREFIXO_FOLLOWUP}${chave} - ${nome} - ${numSocio}`;
    const evento = calendar.createAllDayEvent(tituloEvento, dataEvento, {
      description: `Follow-up ${chave}\nContacto: ${contacto}\n\n---\nMensagem sugerida:\n${mensagem}`,
    });

    supabaseFetch('/rest/v1/tarefas_followup', 'POST', {
      num_socio:         numSocio,
      contacto:          contacto,
      tipo:              chave,
      data_prevista:     dataEvento.toISOString().split('T')[0],
      estado:            'pendente',
      mensagem:          mensagem,
      calendar_event_id: evento.getId(),
    }, { 'Prefer': 'return=minimal' });
  });

  supabaseFetch(
    `/rest/v1/alunos?num_socio=eq.${encodeURIComponent(numSocio)}&contacto=eq.${encodeURIComponent(contacto)}`,
    'PATCH',
    { plano_confirmado_em: new Date(dataConfirmacao).toISOString().split('T')[0] },
    { 'Prefer': 'return=minimal' }
  );

  Logger.log(`Follow-ups criados para ${nome} (${numSocio})`);
}

// ============================================================
// PONTO DE ENTRADA HTTP (web app publicada)
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const acao = body.acao;

    if (acao === 'confirmar_plano') {
      criarFollowUps(
        body.num_socio,
        body.contacto,
        body.nome,
        body.tipo,
        body.data_confirmacao || new Date().toISOString().split('T')[0]
      );
      return jsonResponse({ ok: true, mensagem: 'Follow-ups criados' });
    }

    if (acao === 'marcar_tarefa') {
      marcarTarefa(body.tarefa_id, body.estado, body.calendar_event_id);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, erro: 'Acção desconhecida' });

  } catch (err) {
    Logger.log('Erro doPost: ' + err.toString());
    return jsonResponse({ ok: false, erro: err.toString() });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, timestamp: new Date().toISOString() });
}

// ============================================================
// MARCAR TAREFA COMO REALIZADA / NÃO REALIZADA
// ============================================================
function marcarTarefa(tarefaId, estado, calendarEventId) {
  if (calendarEventId) {
    try {
      const evento = CalendarApp.getEventById(calendarEventId);
      if (evento) evento.deleteEvent();
    } catch (err) {
      Logger.log('Evento de Calendar não encontrado: ' + calendarEventId);
    }
  }

  supabaseFetch(
    '/rest/v1/tarefas_followup?id=eq.' + tarefaId,
    'PATCH',
    { estado: estado, feito_em: new Date().toISOString() },
    { 'Prefer': 'return=minimal' }
  );
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function supabaseFetch(path, method, body, extraHeaders) {
  const options = {
    method:             method,
    headers: Object.assign({
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json',
    }, extraHeaders || {}),
    muteHttpExceptions: true,
  };

  if (body && method !== 'GET') {
    options.payload = JSON.stringify(body);
  }

  try {
    const resp = UrlFetchApp.fetch(SUPABASE_URL + path, options);
    const code = resp.getResponseCode();
    const text = resp.getContentText();

    if (code >= 400) {
      Logger.log(`Supabase erro ${code}: ${text}`);
      return { error: text };
    }

    return text ? JSON.parse(text) : null;
  } catch (err) {
    Logger.log('Erro HTTP: ' + err.toString());
    return null;
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// CONFIGURAR TRIGGER AUTOMÁTICO
// Correr esta função UMA VEZ para activar a sincronização horária
// ============================================================
function configurarTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncCalendarToSupabase')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Trigger configurado — sync a cada hora.');
}
