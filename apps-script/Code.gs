// ============================================================
// PT FOLLOW-UP — Google Apps Script
// Liga o Google Calendar ao Supabase
// ============================================================

const SUPABASE_URL = 'https://zvsoymtlmpnfaskjwvos.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2c295bXRsbXBuZmFza2p3dm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODM3MTYsImV4cCI6MjA5NjE1OTcxNn0.JilJkj--p_viCJxtbQYg4iO3yOvg7pSm8qOlouzeD3g';

// Prefixo dos eventos de follow-up (não processar)
const PREFIXO_FOLLOWUP = 'followup__';

// Dias de janela para o sync normal (passado e futuro)
const JANELA_DIAS_ANTES  = 1;
const JANELA_DIAS_DEPOIS = 30;

// Tipos de sessão de treino PT — mapeados directamente para tipo_sessao_id
// Formato no calendário: "treino_60 Nome - NumSocio"  ou  "treino_60 Nome"
const TIPOS_SESSAO_PT = ['treino_60', 'treino_45', 'sw'];

// Tipos standalone — sem aluno associado (título é apenas o código)
// Duração calculada pela hora início/fim do evento
const TIPOS_STANDALONE = ['mi'];

// Tipos de avaliação/prospeção — identificam também o tipo de aluno
// Formato: "rep Nome - NumSocio"  ou  "oi Nome - NumSocio"
const TIPOS_AVALIACAO = ['rep', 'oi', 'treino oferta', 'treino_oferta', 'apresentacao'];

// Mensagens de follow-up por tipo de aluno e momento
const MENSAGENS = {
  rep: {
    '7d':  (nome) => `Olá ${nome}! 👋 Já passaram 7 dias desde que ficou com o plano de treino. Como está a correr? Está a conseguir seguir as indicações?`,
    '30d': (nome) => `Olá ${nome}! Já passou um mês desde a avaliação. Como se está a sentir com o plano? Alguma dúvida ou ajuste que queira fazer?`,
    '60d': (nome) => `Olá ${nome}! Dois meses a trabalhar no plano — como está a correr a evolução? Gostava de saber como se sente.`,
    '120d':(nome) => `Olá ${nome}! Já passaram 4 meses desde a sua avaliação. Está na altura de fazer uma nova avaliação e ver a sua evolução! Quando é que lhe dá jeito?`,
  },
  oi: {
    '7d':  (nome) => `Olá ${nome}! 👋 Já passaram 7 dias desde que ficou com o plano. Como está a correr?`,
    '30d': (nome) => `Olá ${nome}! Já passou um mês. Como se está a sentir com o plano de treino?`,
    '60d': (nome) => `Olá ${nome}! Dois meses de treino — como está a evoluir?`,
    '120d':(nome) => `Olá ${nome}! Já passaram 4 meses desde a sua avaliação. Está na altura de marcar uma nova!`,
  },
  treino_oferta: {
    '7d':  (nome) => `Olá ${nome}! 👋 Espero que tenha gostado do treino! Como se sentiu?`,
    '30d': (nome) => `Olá ${nome}! Já passou um mês desde o seu treino experimental. Tem pensado em começar um plano de personal training?`,
    '60d': (nome) => `Olá ${nome}! Como está a correr o treino? Se quiser elevar os resultados com um programa personalizado, estou disponível para conversar. 💪`,
    '120d':(nome) => `Olá ${nome}! Há 4 meses que fez o seu treino experimental connosco. Gostava de voltar a fazer uma avaliação?`,
  },
};

// ============================================================
// FUNÇÃO PRINCIPAL — correr via trigger (a cada hora ou diária)
// ============================================================
function syncCalendarToSupabase() {
  const agora = new Date();
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - JANELA_DIAS_ANTES);
  const fim = new Date(agora);
  fim.setDate(fim.getDate() + JANELA_DIAS_DEPOIS);
  sincronizarPeriodo(inicio, fim);
}

// ============================================================
// BACKFILL DESDE 1 DE JUNHO — correr UMA VEZ manualmente
// ============================================================
function sincronizarDesde1Junho() {
  const inicio = new Date('2026-06-01T00:00:00');
  const fim = new Date();
  fim.setDate(fim.getDate() + JANELA_DIAS_DEPOIS);
  sincronizarPeriodo(inicio, fim);
  Logger.log('Backfill desde 1 de junho concluído.');
}

// ============================================================
// SINCRONIZAR PERÍODO
// ============================================================
function sincronizarPeriodo(inicio, fim) {
  const niveis    = carregarNiveis();
  const tipos     = carregarTiposSessao();
  const calendario = CalendarApp.getDefaultCalendar();
  const eventos   = calendario.getEvents(inicio, fim);

  let processados = 0;
  let ignorados   = 0;

  eventos.forEach(evento => {
    const titulo = evento.getTitle().trim();
    if (titulo.toLowerCase().startsWith(PREFIXO_FOLLOWUP)) { ignorados++; return; }

    const startTime  = evento.getStartTime();
    const endTime    = evento.getEndTime();
    const dataEvento = Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const horaInicio = Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'HH:mm');
    const duracaoMin = Math.round((endTime - startTime) / 60000); // duração em minutos

    // Verificar se é evento standalone (ex: "mi")
    const tituloLower = titulo.toLowerCase().trim();
    const tipoStandalone = TIPOS_STANDALONE.find(t => tituloLower === t);
    if (tipoStandalone) {
      registarSessaoStandalone(tipoStandalone, dataEvento, horaInicio, duracaoMin, niveis, tipos);
      processados++;
      return;
    }

    const parsed = parsearEvento(titulo, evento.getDescription());
    if (!parsed) { ignorados++; return; }

    if (parsed.categoria === 'avaliacao') {
      const aluno = upsertAluno(parsed, dataEvento);
      if (!aluno) return;
    }

    registarSessaoComValor(parsed, dataEvento, horaInicio, niveis, tipos);
    processados++;
  });

  Logger.log('Sync ' + Utilities.formatDate(inicio, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
    ' → ' + Utilities.formatDate(fim, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
    ' | processados: ' + processados + ' | ignorados: ' + ignorados);
}

// ============================================================
// PARSE DO EVENTO
// Formatos aceites:
//   "treino_60 Nome Apelido - 1234"   → PT session
//   "treino_60 Nome Apelido"          → PT session (lookup por nome)
//   "mi Nome Apelido - 1234"          → MI session
//   "rep Nome Apelido - 1234"         → Avaliação rep
//   "oi Nome Apelido - 1234"          → Avaliação oi
//   "treino oferta Nome - 1234"       → Avaliação treino oferta
//   "apresentacao Nome - 1234"        → Apresentação (sem valor)
// ============================================================
function parsearEvento(titulo, descricao) {
  const tituloLower = titulo.toLowerCase();

  let tipoSessaoId = null;
  let categoria    = null;
  let tipoAluno    = null;
  let restoTitulo  = titulo;

  // Verificar tipos PT (treino_60, treino_45, mi, sw)
  for (const t of TIPOS_SESSAO_PT) {
    if (tituloLower.startsWith(t + ' ') || tituloLower === t) {
      tipoSessaoId = t;
      categoria    = 'treino';
      restoTitulo  = titulo.substring(t.length).trim();
      break;
    }
  }

  // Verificar tipos avaliação/prospeção
  if (!tipoSessaoId) {
    for (const prefixo of TIPOS_AVALIACAO) {
      if (tituloLower.startsWith(prefixo + ' ') || tituloLower === prefixo) {
        tipoAluno    = prefixo.replace(' ', '_').replace('treino_oferta', 'treino_oferta');
        tipoSessaoId = tipoAluno; // o id da sessão é igual ao tipo de aluno
        categoria    = 'avaliacao';
        restoTitulo  = titulo.substring(prefixo.length).trim();
        break;
      }
    }
  }

  if (!tipoSessaoId) return null;
  if (!restoTitulo)  return null;

  // Extrair nome e numSocio (o numSocio é opcional — " - 1234" no fim)
  let nome     = restoTitulo;
  let numSocio = null;
  const sepIdx = restoTitulo.lastIndexOf(' - ');
  if (sepIdx !== -1) {
    nome     = restoTitulo.substring(0, sepIdx).trim();
    numSocio = restoTitulo.substring(sepIdx + 3).trim();
  }

  if (!nome) return null;

  const contacto = extrairContacto(descricao);

  return { tipoSessaoId, categoria, tipoAluno, nome, numSocio, contacto };
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
// UPSERT ALUNO (apenas para avaliações)
// ============================================================
function upsertAluno(parsed, dataEvento) {
  if (!parsed.numSocio || !parsed.contacto) {
    Logger.log('Aluno sem numSocio ou contacto: ' + parsed.nome);
    return null;
  }

  const payload = {
    num_socio:        parsed.numSocio,
    contacto:         parsed.contacto,
    nome:             parsed.nome,
    tipo:             parsed.tipoAluno || parsed.tipoSessaoId,
    ultima_avaliacao: dataEvento,
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
// PROCURAR ALUNO NA BD (por numSocio ou por nome)
// ============================================================
function procurarAluno(parsed) {
  if (parsed.numSocio) {
    const res = supabaseFetch(
      '/rest/v1/alunos?num_socio=eq.' + encodeURIComponent(parsed.numSocio) + '&select=num_socio,contacto,convertido',
      'GET'
    );
    if (res && res.length > 0) return res[0];
  }

  // Fallback: procurar por nome (match exacto)
  if (parsed.nome) {
    const res = supabaseFetch(
      '/rest/v1/alunos?nome=eq.' + encodeURIComponent(parsed.nome) + '&select=num_socio,contacto,convertido&limit=1',
      'GET'
    );
    if (res && res.length > 0) {
      Logger.log('Match por nome: ' + parsed.nome + ' → ' + res[0].num_socio);
      return res[0];
    }
  }

  return null;
}

// ============================================================
// REGISTAR SESSÃO STANDALONE (sem aluno — ex: MI)
// Duração vem do evento do calendário
// ============================================================
function registarSessaoStandalone(tipoSessaoId, dataEvento, horaInicio, duracaoMin, niveis, tipos) {
  // Verificar se já existe
  const existente = supabaseFetch(
    '/rest/v1/sessoes?num_socio=eq.MI&data_sessao=eq.' + dataEvento +
    '&tipo_sessao_id=eq.' + tipoSessaoId + '&select=id',
    'GET'
  );
  if (existente && existente.length > 0) return;

  const dataObj     = new Date(dataEvento + 'T12:00:00');
  const mesBriefing = dataObj.getFullYear() + '-' + String(dataObj.getMonth() + 1).padStart(2, '0');
  garantirBriefing(mesBriefing, dataObj.getFullYear(), dataObj.getMonth() + 1);

  const tipoInfo = tipos.find(t => t.id === tipoSessaoId);

  // Calcular valor: rep.valor_fixo × ceil(duracaoMin / 60)
  let valorCalculado = null;
  if (tipoSessaoId === 'mi') {
    const repTipo  = tipos.find(t => t.id === 'rep');
    const valorRep = repTipo ? (repTipo.valor_fixo || 0) : 0;
    const horas    = Math.ceil(duracaoMin / 60);
    valorCalculado = valorRep * horas;
  } else if (tipoInfo && tipoInfo.valor_fixo != null) {
    valorCalculado = tipoInfo.valor_fixo;
  }

  const payload = {
    num_socio:         'MI',
    contacto:          '',
    tipo_sessao_id:    tipoSessaoId,
    data_sessao:       dataEvento,
    hora_inicio:       horaInicio || null,
    estado:            'realizada',
    mes_briefing:      mesBriefing,
    incluida_briefing: false,
    conta_horas:       false,
    valor_calculado:   valorCalculado,
  };

  const resp = supabaseFetch('/rest/v1/sessoes', 'POST', payload, { 'Prefer': 'return=minimal' });
  if (resp && resp.error) {
    Logger.log('Erro sessão standalone: ' + JSON.stringify(resp));
  } else {
    Logger.log('Sessão MI: ' + dataEvento + ' | ' + duracaoMin + 'min | ' + valorCalculado + '€');
  }
}

// ============================================================
// REGISTAR SESSÃO COM VALOR CALCULADO
// ============================================================
function registarSessaoComValor(parsed, dataEvento, horaInicio, niveis, tipos) {
  // Procurar aluno na BD
  const aluno = procurarAluno(parsed);
  const numSocio  = aluno ? aluno.num_socio  : parsed.numSocio;
  const contacto  = aluno ? aluno.contacto   : parsed.contacto;

  if (!numSocio) {
    Logger.log('Sessão ignorada — aluno não encontrado: ' + parsed.nome);
    return;
  }

  // Verificar se a sessão já existe
  const existente = supabaseFetch(
    '/rest/v1/sessoes?num_socio=eq.' + encodeURIComponent(numSocio) +
    '&contacto=eq.'    + encodeURIComponent(contacto || '') +
    '&data_sessao=eq.' + dataEvento +
    '&tipo_sessao_id=eq.' + parsed.tipoSessaoId +
    '&select=id',
    'GET'
  );
  if (existente && existente.length > 0) return;

  const dataObj     = new Date(dataEvento + 'T12:00:00');
  const mesBriefing = dataObj.getFullYear() + '-' + String(dataObj.getMonth() + 1).padStart(2, '0');
  garantirBriefing(mesBriefing, dataObj.getFullYear(), dataObj.getMonth() + 1);

  // Tipo de sessão na BD
  const tipoInfo     = tipos.find(t => t.id === parsed.tipoSessaoId);
  const convertido   = aluno ? aluno.convertido : false;
  const contaPorNivel = tipoInfo ? !!tipoInfo.conta_para_nivel : false;
  const contaHoras   = convertido && contaPorNivel;

  // Calcular valor
  const valorCalculado = calcularValor(parsed.tipoSessaoId, tipoInfo, convertido, numSocio, contacto || '', mesBriefing, niveis, tipos);

  const payload = {
    num_socio:         numSocio,
    contacto:          contacto || '',
    tipo_sessao_id:    parsed.tipoSessaoId,
    data_sessao:       dataEvento,
    hora_inicio:       horaInicio || null,
    estado:            'realizada',
    mes_briefing:      mesBriefing,
    incluida_briefing: false,
    conta_horas:       contaHoras,
    valor_calculado:   valorCalculado,
  };

  const resp = supabaseFetch('/rest/v1/sessoes', 'POST', payload, { 'Prefer': 'return=minimal' });
  if (resp && resp.error) {
    Logger.log('Erro ao registar sessão: ' + JSON.stringify(resp));
  } else {
    Logger.log('Sessão registada: ' + parsed.tipoSessaoId + ' | ' + parsed.nome + ' | ' + dataEvento + ' | ' + valorCalculado);
  }
}

// ============================================================
// CÁLCULO DO VALOR DA SESSÃO
// ============================================================
function calcularValor(tipoSessaoId, tipoInfo, convertido, numSocio, contacto, mesBriefing, niveis, tipos) {
  if (!tipoInfo) return null;

  // Avaliação com valor fixo
  if (tipoInfo.categoria === 'avaliacao') {
    return tipoInfo.valor_fixo || 0;
  }

  // Apresentação — sem valor
  if (tipoSessaoId === 'apresentacao') {
    return 0;
  }

  // MI — valor = rep.valor_fixo × ceil(horas)
  if (tipoSessaoId === 'mi') {
    const repTipo  = tipos.find(t => t.id === 'rep');
    const valorRep = repTipo ? (repTipo.valor_fixo || 0) : 0;
    const horas    = Math.ceil((tipoInfo.duracao_min || 60) / 60);
    return valorRep * horas;
  }

  // Treino PT — só calcula para alunos convertidos
  if (tipoInfo.categoria === 'treino' && convertido) {
    // Horas já acumuladas no mês para este aluno (sessões realizadas com conta_para_nivel)
    const sessoesExistentes = supabaseFetch(
      '/rest/v1/sessoes?num_socio=eq.' + encodeURIComponent(numSocio) +
      '&contacto=eq.' + encodeURIComponent(contacto) +
      '&mes_briefing=eq.' + mesBriefing +
      '&estado=eq.realizada' +
      '&select=tipo_sessao_id,conta_horas',
      'GET'
    ) || [];

    const horasAcumuladas = sessoesExistentes.reduce(function(acc, s) {
      const t = tipos.find(function(x) { return x.id === s.tipo_sessao_id; });
      if (!t || !t.conta_para_nivel) return acc;
      return acc + (t.duracao_min || 0) / 60;
    }, 0);

    const durSessao  = (tipoInfo.duracao_min || 60) / 60;
    const horasMes   = horasAcumuladas + durSessao;

    const nivel = niveis
      .filter(function(n) { return horasMes >= n.horas_min && (n.horas_max == null || horasMes < n.horas_max); })
      .pop();

    if (!nivel) return null;
    return (tipoInfo.duracao_min || 60) <= 45 ? nivel.valor_45min : nivel.valor_60min;
  }

  // SW ou outro tipo sem lógica especial — valor fixo se existir
  if (tipoInfo.valor_fixo != null) return tipoInfo.valor_fixo;

  return null;
}

// ============================================================
// CARREGAR DADOS DA BD (cache para a sessão do script)
// ============================================================
function carregarNiveis() {
  const resp = supabaseFetch('/rest/v1/niveis_remuneracao?select=*&order=horas_min', 'GET');
  return resp || [];
}

function carregarTiposSessao() {
  const resp = supabaseFetch('/rest/v1/tipos_sessao?select=*', 'GET');
  return resp || [];
}

// ============================================================
// GARANTIR BRIEFING DO MÊS
// ============================================================
function garantirBriefing(id, ano, mes) {
  const existente = supabaseFetch('/rest/v1/briefings?id=eq.' + id + '&select=id', 'GET');
  if (existente && existente.length > 0) return;

  supabaseFetch('/rest/v1/briefings', 'POST', {
    id: id, ano: ano, mes: mes, estado: 'aberto',
    total_bruto: 0, irs_retido: 0, ss_pagar: 0, liquido: 0, horas_contadas: 0,
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

  sequencia.forEach(function({ dias, chave }) {
    const dataEvento = new Date(base);
    dataEvento.setDate(dataEvento.getDate() + dias);

    const mensagemFn = (MENSAGENS[tipo] || MENSAGENS['rep'])[chave];
    const mensagem   = mensagemFn(nome);
    const titulo     = PREFIXO_FOLLOWUP + chave + ' - ' + nome + ' - ' + numSocio;

    const evento = calendar.createAllDayEvent(titulo, dataEvento, {
      description: 'Follow-up ' + chave + '\nContacto: ' + contacto + '\n\n---\nMensagem sugerida:\n' + mensagem,
    });

    supabaseFetch('/rest/v1/tarefas_followup', 'POST', {
      num_socio: numSocio, contacto: contacto, tipo: chave,
      data_prevista: dataEvento.toISOString().split('T')[0],
      estado: 'pendente', mensagem: mensagem,
      calendar_event_id: evento.getId(),
    }, { 'Prefer': 'return=minimal' });
  });

  supabaseFetch(
    '/rest/v1/alunos?num_socio=eq.' + encodeURIComponent(numSocio) + '&contacto=eq.' + encodeURIComponent(contacto),
    'PATCH',
    { plano_confirmado_em: new Date(dataConfirmacao).toISOString().split('T')[0] },
    { 'Prefer': 'return=minimal' }
  );

  Logger.log('Follow-ups criados para ' + nome + ' (' + numSocio + ')');
}

// ============================================================
// PONTO DE ENTRADA HTTP (web app publicada)
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const acao = body.acao;

    if (acao === 'confirmar_plano') {
      criarFollowUps(body.num_socio, body.contacto, body.nome, body.tipo,
        body.data_confirmacao || new Date().toISOString().split('T')[0]);
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
// MARCAR TAREFA
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

  supabaseFetch('/rest/v1/tarefas_followup?id=eq.' + tarefaId, 'PATCH',
    { estado: estado, feito_em: new Date().toISOString() },
    { 'Prefer': 'return=minimal' });
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function supabaseFetch(path, method, body, extraHeaders) {
  const options = {
    method: method,
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
      Logger.log('Supabase erro ' + code + ': ' + text);
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
  ScriptApp.newTrigger('syncCalendarToSupabase').timeBased().everyHours(1).create();
  Logger.log('Trigger configurado — sync a cada hora.');
}
