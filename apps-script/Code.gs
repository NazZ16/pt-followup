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
const JANELA_DIAS_DEPOIS = 7;

// Tipos de sessão de treino PT — mapeados directamente para tipo_sessao_id
// Formato no calendário: "treino_60 Nome - NumSocio"  ou  "treino_60 Nome"
const TIPOS_SESSAO_PT = ['treino_60', 'treino_45', 'sw'];

// Tipos standalone — sem aluno associado (título é apenas o código)
// Duração calculada pela hora início/fim do evento
// n1-n6: aulas de natação por nível; n1f-n6f: feminino
const TIPOS_STANDALONE = ['mi', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n1f', 'n2f', 'n3f', 'n4f', 'n5f', 'n6f'];

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
  // Começa meia hora antes do dia 1 para evitar problemas de timezone
  const inicio = new Date('2026-05-31T23:30:00');
  const fim = new Date(); // apenas até hoje
  sincronizarPeriodo(inicio, fim);
  Logger.log('Backfill desde 1 de junho concluído.');
}

// ============================================================
// SINCRONIZAR PERÍODO
// ============================================================
function sincronizarPeriodo(inicio, fim) {
  const niveis     = carregarNiveis();
  const tipos      = carregarTiposSessao();
  const nivelAtual = calcularNivelAtual(niveis);
  Logger.log('Nivel actual: ' + (nivelAtual ? nivelAtual.nivel : 'nenhum'));
  const calendario = CalendarApp.getDefaultCalendar();
  const eventos    = calendario.getEvents(inicio, fim);

  const eventIdsVistos = []; // IDs dos eventos do calendário processados neste sync
  let processados = 0;
  let ignorados   = 0;

  eventos.forEach(function(evento) {
    const titulo = evento.getTitle().trim();
    if (titulo.toLowerCase().startsWith(PREFIXO_FOLLOWUP)) { ignorados++; return; }

    const startTime  = evento.getStartTime();
    const endTime    = evento.getEndTime();
    const dataEvento = Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const eventId    = evento.getId() + '::' + dataEvento; // unique per occurrence for recurring events
    const horaInicio = Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'HH:mm');
    const duracaoMin = Math.round((endTime - startTime) / 60000);

    const tituloLower = titulo.toLowerCase().trim();
    const tipoStandalone = TIPOS_STANDALONE.find(function(t) { return tituloLower === t; });
    if (tipoStandalone) {
      registarSessaoStandalone(eventId, tipoStandalone, dataEvento, horaInicio, duracaoMin, nivelAtual, tipos);
      eventIdsVistos.push(eventId);
      processados++;
      return;
    }

    const parsed = parsearEvento(titulo, evento.getDescription());
    if (!parsed) {
      const alunoMatch = procurarAlunoPorNome(titulo);
      if (alunoMatch) {
        const tipoSessaoId = alunoMatch.duracao_min <= 45 ? 'treino_45' : 'treino_60';
        registarSessaoComValor(
          { tipoSessaoId, categoria: 'treino', tipoAluno: null, nome: alunoMatch.nome, numSocio: alunoMatch.num_socio, contacto: alunoMatch.contacto },
          eventId, dataEvento, horaInicio, nivelAtual, tipos
        );
        eventIdsVistos.push(eventId);
        processados++;
      } else {
        ignorados++;
      }
      return;
    }

    if (parsed.categoria === 'avaliacao') {
      const aluno = upsertAluno(parsed, dataEvento);
      if (!aluno) return;
    }

    registarSessaoComValor(parsed, eventId, dataEvento, horaInicio, nivelAtual, tipos);
    eventIdsVistos.push(eventId);
    processados++;
  });

  // Cancelar sessões cujo evento já não existe no calendário (dentro da janela)
  cancelarSessoesRemovidas(inicio, fim, eventIdsVistos);

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
// PROCURAR ALUNO PT ACTIVO POR NOME (para eventos sem código)
// Retorna { num_socio, contacto, nome, duracao_min } ou null
// ============================================================
function procurarAlunoPorNome(titulo) {
  const tituloNorm = titulo.toLowerCase().trim();
  const alunosPT = supabaseFetch(
    '/rest/v1/alunos?convertido=eq.true&estado=eq.ativo&select=num_socio,contacto,nome,plano_pt,horas_pt_mensais',
    'GET'
  ) || [];
  const servicosPT = supabaseFetch('/rest/v1/servicos_pt?select=*', 'GET') || [];

  for (const a of alunosPT) {
    const nomeNorm = (a.nome || '').toLowerCase().trim();
    // Match exacto ou se o titulo contém o nome completo
    if (tituloNorm === nomeNorm || tituloNorm.includes(nomeNorm)) {
      const sv = servicosPT.find(function(s) { return s.nome === a.plano_pt; });
      const duracao_min = sv ? (sv.duracao_min || 60) : 60;
      Logger.log('Match por nome PT: "' + titulo + '" → ' + a.nome + ' (' + duracao_min + 'min)');
      return { num_socio: a.num_socio, contacto: a.contacto, nome: a.nome, duracao_min: duracao_min };
    }
  }
  return null;
}

// ============================================================
// REGISTAR SESSÃO STANDALONE (sem aluno — ex: MI)
// Duração vem do evento do calendário
// ============================================================
function registarSessaoStandalone(eventId, tipoSessaoId, dataEvento, horaInicio, duracaoMin, nivelAtual, tipos) {
  const tipoInfo = tipos.find(function(t) { return t.id === tipoSessaoId; });

  let valorCalculado = null;
  if (tipoSessaoId === 'mi') {
    const repTipo  = tipos.find(function(t) { return t.id === 'rep'; });
    const valorRep = repTipo ? (repTipo.valor_fixo || 0) : 0;
    const horas    = Math.ceil(duracaoMin / 60);
    valorCalculado = valorRep * horas;
  } else if (tipoInfo && tipoInfo.valor_fixo != null) {
    valorCalculado = tipoInfo.valor_fixo;
  } else if (tipoInfo && tipoInfo.categoria === 'treino' && nivelAtual) {
    const dur = tipoInfo.duracao_min || duracaoMin;
    valorCalculado = dur <= 45 ? nivelAtual.valor_45min : nivelAtual.valor_60min;
  }

  const dataObj     = new Date(dataEvento + 'T12:00:00');
  const mesBriefing = dataObj.getFullYear() + '-' + String(dataObj.getMonth() + 1).padStart(2, '0');
  garantirBriefing(mesBriefing, dataObj.getFullYear(), dataObj.getMonth() + 1);

  const logLabel = tipoSessaoId === 'mi' ? 'MI' : 'Natação ' + tipoSessaoId.toUpperCase();

  // Procurar por calendar_event_id (se a coluna existir)
  const existentePorId = supabaseFetch(
    '/rest/v1/sessoes?calendar_event_id=eq.' + encodeURIComponent(eventId) + '&select=id',
    'GET'
  );
  const colunaCEIdExiste = Array.isArray(existentePorId); // erro = objeto, array = coluna existe

  if (colunaCEIdExiste && existentePorId.length > 0) {
    // Atualizar sessão existente pelo calendar_event_id
    const sessaoId = existentePorId[0].id;
    const patch = {
      tipo_sessao_id:  tipoSessaoId,
      data_sessao:     dataEvento,
      hora_inicio:     horaInicio || null,
      mes_briefing:    mesBriefing,
      valor_calculado: valorCalculado,
    };
    const resp = supabaseFetch('/rest/v1/sessoes?id=eq.' + sessaoId, 'PATCH', patch, { 'Prefer': 'return=minimal' });
    if (resp && resp.error) Logger.log('Erro update sessão standalone: ' + JSON.stringify(resp));
    else Logger.log('Sessão ' + logLabel + ' actualizada: ' + dataEvento + ' | ' + valorCalculado + '€');
    return;
  }

  // Fallback: verificar por data + tipo (evita duplicados se coluna ainda não existe)
  if (!colunaCEIdExiste) {
    const existentePorData = supabaseFetch(
      '/rest/v1/sessoes?num_socio=is.null&data_sessao=eq.' + dataEvento + '&tipo_sessao_id=eq.' + tipoSessaoId + '&select=id',
      'GET'
    );
    if (existentePorData && existentePorData.length > 0) {
      Logger.log('Sessão ' + logLabel + ' já existe (sem calendar_event_id): ' + dataEvento);
      return;
    }
  }

  // Inserir nova sessão
  const payload = {
    tipo_sessao_id:    tipoSessaoId,
    data_sessao:       dataEvento,
    hora_inicio:       horaInicio || null,
    estado:            'realizada',
    mes_briefing:      mesBriefing,
    incluida_briefing: false,
    conta_horas:       false,
    valor_calculado:   valorCalculado,
  };
  if (colunaCEIdExiste) payload.calendar_event_id = eventId;
  const resp = supabaseFetch('/rest/v1/sessoes', 'POST', payload, { 'Prefer': 'return=minimal' });
  if (resp && resp.error) {
    Logger.log('Erro sessão standalone: ' + JSON.stringify(resp));
  } else {
    Logger.log('Sessão ' + logLabel + ': ' + dataEvento + ' | ' + duracaoMin + 'min | ' + valorCalculado + '€');
  }
}

// ============================================================
// REGISTAR SESSÃO COM VALOR CALCULADO
// ============================================================
function registarSessaoComValor(parsed, eventId, dataEvento, horaInicio, nivelAtual, tipos) {
  const aluno    = procurarAluno(parsed);
  const numSocio = aluno ? aluno.num_socio : parsed.numSocio;
  const contacto = aluno ? aluno.contacto  : parsed.contacto;

  if (!numSocio) {
    Logger.log('Sessão ignorada — aluno não encontrado: ' + parsed.nome);
    return;
  }

  const tipoInfo      = tipos.find(function(t) { return t.id === parsed.tipoSessaoId; });
  const convertido    = aluno ? aluno.convertido : false;
  const contaHoras    = convertido && tipoInfo ? !!tipoInfo.conta_para_nivel : false;
  const valorCalculado = calcularValor(parsed.tipoSessaoId, tipoInfo, convertido, nivelAtual, tipos);

  const dataObj     = new Date(dataEvento + 'T12:00:00');
  const mesBriefing = dataObj.getFullYear() + '-' + String(dataObj.getMonth() + 1).padStart(2, '0');
  garantirBriefing(mesBriefing, dataObj.getFullYear(), dataObj.getMonth() + 1);

  // Procurar por calendar_event_id (se a coluna existir)
  const existentePorId = supabaseFetch(
    '/rest/v1/sessoes?calendar_event_id=eq.' + encodeURIComponent(eventId) + '&select=id',
    'GET'
  );
  const colunaCEIdExiste = Array.isArray(existentePorId);

  if (colunaCEIdExiste && existentePorId.length > 0) {
    // Actualizar — data, tipo, aluno ou valor podem ter mudado
    const sessaoId = existentePorId[0].id;
    const patch = {
      num_socio:       numSocio,
      contacto:        contacto || '',
      tipo_sessao_id:  parsed.tipoSessaoId,
      data_sessao:     dataEvento,
      hora_inicio:     horaInicio || null,
      mes_briefing:    mesBriefing,
      conta_horas:     contaHoras,
      valor_calculado: valorCalculado,
    };
    const resp = supabaseFetch('/rest/v1/sessoes?id=eq.' + sessaoId, 'PATCH', patch, { 'Prefer': 'return=minimal' });
    if (resp && resp.error) Logger.log('Erro update sessão: ' + JSON.stringify(resp));
    else Logger.log('Sessão actualizada: ' + parsed.tipoSessaoId + ' | ' + parsed.nome + ' | ' + dataEvento);
    return;
  }

  // Fallback: verificar por aluno + data + tipo (evita duplicados se coluna ainda não existe)
  if (!colunaCEIdExiste) {
    const existentePorData = supabaseFetch(
      '/rest/v1/sessoes?num_socio=eq.' + encodeURIComponent(numSocio) +
      '&data_sessao=eq.' + dataEvento +
      '&tipo_sessao_id=eq.' + parsed.tipoSessaoId + '&select=id',
      'GET'
    );
    if (existentePorData && existentePorData.length > 0) {
      Logger.log('Sessão já existe (sem calendar_event_id): ' + parsed.nome + ' ' + dataEvento);
      return;
    }
  }

  // Inserir nova sessão
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
  if (colunaCEIdExiste) payload.calendar_event_id = eventId;
  const resp = supabaseFetch('/rest/v1/sessoes', 'POST', payload, { 'Prefer': 'return=minimal' });
  if (resp && resp.error) {
    Logger.log('Erro ao registar sessão: ' + JSON.stringify(resp));
  } else {
    Logger.log('Sessão registada: ' + parsed.tipoSessaoId + ' | ' + parsed.nome + ' | ' + dataEvento + ' | ' + valorCalculado);
  }
}

// ============================================================
// CÁLCULO DO VALOR DA SESSÃO
// nivelAtual — determinado pelas horas totais de planos vendidos
// ============================================================
function calcularValor(tipoSessaoId, tipoInfo, convertido, nivelAtual, tipos) {
  if (!tipoInfo) return null;

  // Avaliação com valor fixo
  if (tipoInfo.categoria === 'avaliacao') {
    return tipoInfo.valor_fixo || 0;
  }

  // Apresentação — sem valor
  if (tipoSessaoId === 'apresentacao') {
    return 0;
  }

  // MI — rep.valor_fixo × ceil(horas da duração do evento)
  if (tipoSessaoId === 'mi') {
    const repTipo  = tipos.find(function(t) { return t.id === 'rep'; });
    const valorRep = repTipo ? (repTipo.valor_fixo || 0) : 0;
    const horas    = Math.ceil((tipoInfo.duracao_min || 60) / 60);
    return valorRep * horas;
  }

  // Treino PT — nivel fixo baseado nos planos vendidos, valor conforme duração
  if (tipoInfo.categoria === 'treino' && convertido && nivelAtual) {
    const duracao = tipoInfo.duracao_min || 60;
    if (duracao <= 30) return nivelAtual.valor_30min;
    if (duracao <= 45) return nivelAtual.valor_45min;
    return nivelAtual.valor_60min;
  }

  // Outro tipo com valor fixo
  if (tipoInfo.valor_fixo != null) return tipoInfo.valor_fixo;

  return null;
}

// ============================================================
// ============================================================
// CANCELAR SESSÕES CUJO EVENTO JÁ NÃO EXISTE NO CALENDÁRIO
// Só actua sobre sessões com calendar_event_id e estado != cancelada
// ============================================================
function cancelarSessoesRemovidas(inicio, fim, eventIdsVistos) {
  const dataInicio = Utilities.formatDate(inicio, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dataFim    = Utilities.formatDate(fim,    Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const sessoes = supabaseFetch(
    '/rest/v1/sessoes?calendar_event_id=not.is.null' +
    '&data_sessao=gte.' + dataInicio +
    '&data_sessao=lte.' + dataFim +
    '&estado=neq.cancelada' +
    '&select=id,calendar_event_id,estado',
    'GET'
  ) || [];

  sessoes.forEach(function(s) {
    if (eventIdsVistos.indexOf(s.calendar_event_id) === -1) {
      // Evento já não existe no calendário → cancelar
      supabaseFetch('/rest/v1/sessoes?id=eq.' + s.id, 'PATCH', { estado: 'cancelada' }, { 'Prefer': 'return=minimal' });
      Logger.log('Sessão cancelada (evento removido do calendário): ' + s.id);
    }
  });
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

// Calcula as horas totais de planos vendidos (alunos PT activos)
// Determina o nivel de remuneração actual
function calcularNivelAtual(niveis) {
  const alunosPT = supabaseFetch(
    '/rest/v1/alunos?convertido=eq.true&estado=eq.ativo&select=plano_pt,horas_pt_mensais',
    'GET'
  ) || [];
  const servicosPT = supabaseFetch('/rest/v1/servicos_pt?select=*', 'GET') || [];

  const horasTotal = alunosPT.reduce(function(acc, a) {
    const sv = servicosPT.find(function(s) { return s.nome === a.plano_pt; });
    if (sv) {
      const dur = (sv.duracao_min || 60) / 60;
      const sessoes = sv.sessoes_semana || 1;
      const mult = sv.tipo === 'semanal' ? 4.33 : 1;
      return acc + sessoes * mult * dur;
    }
    return acc + (a.horas_pt_mensais || 0);
  }, 0);

  Logger.log('Horas plano total: ' + Math.round(horasTotal * 100) / 100);

  return niveis
    .filter(function(n) { return horasTotal >= n.horas_min && (n.horas_max == null || horasTotal < n.horas_max); })
    .pop() || null;
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
// DIAGNÓSTICO — correr manualmente para ver o que está a falhar
// ============================================================
function diagnosticar() {
  // 1. Verificar se a coluna calendar_event_id existe
  const teste = supabaseFetch('/rest/v1/sessoes?calendar_event_id=is.null&limit=1&select=id', 'GET');
  Logger.log('Coluna calendar_event_id existe: ' + Array.isArray(teste));

  // 2. Verificar tipos_sessao que o script usa
  const tipos = supabaseFetch('/rest/v1/tipos_sessao?select=id,nome,categoria,valor_fixo', 'GET') || [];
  const standaloneTipos = ['mi','n1','n2','n3','n4','n5','n6','n1f','n2f','n3f','n4f','n5f','n6f'];
  standaloneTipos.forEach(function(t) {
    const encontrado = tipos.find(function(x) { return x.id === t; });
    Logger.log('Tipo "' + t + '": ' + (encontrado ? 'OK (valor_fixo=' + encontrado.valor_fixo + ')' : 'NÃO ENCONTRADO NA BD'));
  });

  // 3. Verificar briefing de junho
  const briefingJunho = supabaseFetch('/rest/v1/briefings?id=eq.2026-06&select=id,estado', 'GET');
  Logger.log('Briefing 2026-06: ' + JSON.stringify(briefingJunho));

  // 4. Testar um INSERT simples de natação
  const payloadTeste = {
    tipo_sessao_id: 'n1',
    data_sessao: '2026-06-01',
    estado: 'realizada',
    mes_briefing: '2026-06',
    incluida_briefing: false,
    conta_horas: false,
    valor_calculado: 0,
  };
  const respTeste = supabaseFetch('/rest/v1/sessoes', 'POST', payloadTeste, { 'Prefer': 'return=representation' });
  Logger.log('Teste INSERT n1: ' + JSON.stringify(respTeste));

  // Se inseriu, apagar o registo de teste
  if (Array.isArray(respTeste) && respTeste.length > 0 && respTeste[0].id) {
    supabaseFetch('/rest/v1/sessoes?id=eq.' + respTeste[0].id, 'DELETE', null, {});
    Logger.log('Registo de teste apagado.');
  }
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
