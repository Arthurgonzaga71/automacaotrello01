// server.js
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
app.use(express.json());

// ============ CACHE PARA EVITAR DUPLICIDADE ============
const processedCards = new Map();
const CACHE_TTL = 15000; // 15 segundos

// ============ SUPORTE PARA VALIDAÇÃO DO TRELLO ============
app.head('/webhook', (req, res) => res.sendStatus(200));

// ============ CONFIG ============
const TRELLO = {
  key: process.env.TRELLO_KEY,
  token: process.env.TRELLO_TOKEN,
  boardId: process.env.BOARD_ID,
  base: 'https://api.trello.com/1'
};

const NOTIFICATIONS = {
  discord: process.env.DISCORD_WEBHOOK,
  telegram: process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID,
  email: process.env.EMAIL_USER && process.env.EMAIL_PASS
};

// ============ HELPERS ============
const trelloApi = (endpoint, method = 'GET', data = null) => {
  const url = `${TRELLO.base}${endpoint}?key=${TRELLO.key}&token=${TRELLO.token}`;
  return axios({ method, url, data });
};

// ============ FUNÇÃO PARA FORMATAR MENSAGENS ============
const formatMessage = (title, content, emoji) => {
  const line = '─'.repeat(30);
  return `
${emoji} ${title}
${line}
${content}
${line}
🕐 ${new Date().toLocaleString('pt-BR')}`;
};

const sendNotification = async (message) => {
  console.log(`📤 Enviando notificação: ${message}`);
  const promises = [];
  
  if (NOTIFICATIONS.discord) {
    promises.push(axios.post(NOTIFICATIONS.discord, { content: message }));
  }
  
  if (NOTIFICATIONS.telegram) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
    promises.push(axios.post(url, { 
      chat_id: process.env.TELEGRAM_CHAT_ID, 
      text: message,
      parse_mode: 'HTML'
    }));
  }
  
  if (NOTIFICATIONS.email) {
    console.log(`📧 Email seria enviado: ${message}`);
  }
  
  const results = await Promise.allSettled(promises);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Notificação ${index + 1} falhou:`, result.reason?.message);
    }
  });
  
  return results;
};

const getCard = async (cardId) => {
  const { data } = await trelloApi(`/cards/${cardId}`);
  return data;
};

const updateCard = async (cardId, updates) => {
  const params = new URLSearchParams(updates).toString();
  await trelloApi(`/cards/${cardId}?${params}`, 'PUT');
};

const addComment = async (cardId, text) => {
  await trelloApi(`/cards/${cardId}/actions/comments`, 'POST', { text });
};

const addLabel = async (cardId, labelName) => {
  try {
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log(`🏷️ Adicionando etiqueta "${labelName}" ao card ${cardId}`);
    const { data: labels } = await trelloApi(`/boards/${TRELLO.boardId}/labels`);
    const label = labels.find(l => l.name === labelName);
    if (!label) {
      console.log(`⚠️ Etiqueta "${labelName}" não encontrada`);
      return;
    }
    const card = await getCard(cardId);
    const currentLabels = card.idLabels || [];
    if (!currentLabels.includes(label.id)) {
      await trelloApi(`/cards/${cardId}/idLabels`, 'POST', { value: label.id });
      console.log(`✅ Etiqueta "${labelName}" adicionada`);
    }
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`⏳ Rate limit ao adicionar etiqueta, aguardando...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await addLabel(cardId, labelName);
    } else {
      console.error(`❌ Erro ao adicionar etiqueta "${labelName}":`, error.message);
    }
  }
};

const removeLabel = async (cardId, labelName) => {
  try {
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const card = await getCard(cardId);
    const { data: labels } = await trelloApi(`/boards/${TRELLO.boardId}/labels`);
    const label = labels.find(l => l.name === labelName);
    if (label && card.idLabels?.includes(label.id)) {
      await trelloApi(`/cards/${cardId}/idLabels/${label.id}`, 'DELETE');
      console.log(`✅ Etiqueta "${labelName}" removida`);
    }
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`⏳ Rate limit ao remover etiqueta, aguardando...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await removeLabel(cardId, labelName);
    } else {
      console.error(`❌ Erro ao remover etiqueta "${labelName}":`, error.message);
    }
  }
};

// ============ ACTIONS ============
const actions = {
  '📥 Entrada': async (card) => {
    console.log(`📥 Processando card "${card.name}" na lista Entrada`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addLabel(card.id, 'Novo');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await updateCard(card.id, { 
      due: new Date(Date.now() + 10 * 86400000).toISOString() 
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await trelloApi(`/cards/${card.id}/checklists`, 'POST', { 
      name: 'Checklist Padrão',
      idCard: card.id
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '📥 Card criado com checklist padrão e prazo de 10 dias.');
    const colors = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'pink'];
    await new Promise(resolve => setTimeout(resolve, 1000));
    await updateCard(card.id, { 
      cover: { color: colors[Math.floor(Math.random() * colors.length)] } 
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const message = formatMessage(
      '📥 NOVO CARD NA ENTRADA',
      `📌 <b>Card:</b> ${card.name}\n📋 <b>Lista:</b> Entrada\n⏰ <b>Prazo:</b> 10 dias\n✅ <b>Checklist:</b> Criado`,
      '📥'
    );
    await sendNotification(message);
  },
  
  '🔥 Para Tratar Hoje': async (card) => {
    console.log(`🔥 Processando card "${card.name}" na lista Para Tratar Hoje`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await updateCard(card.id, { due: new Date().toISOString() });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '🔥 Este card deve ser tratado hoje!');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const message = formatMessage(
      '🔥 PARA TRATAR HOJE',
      `📌 <b>Card:</b> ${card.name}\n⏰ <b>Vencimento:</b> Hoje\n⚠️ <b>Prioridade:</b> Alta`,
      '🔥'
    );
    await sendNotification(message);
  },
  
  '🛠️ Em Atendimento': async (card) => {
    console.log(`🛠️ Processando card "${card.name}" na lista Em Atendimento`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await removeLabel(card.id, 'Novo');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addLabel(card.id, 'Tratando');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '🛠️ Em atendimento agora.');
    
    const message = formatMessage(
      '🛠️ EM ATENDIMENTO',
      `📌 <b>Card:</b> ${card.name}\n👤 <b>Status:</b> Em andamento\n⏳ <b>Ação:</b> Atendendo`,
      '🛠️'
    );
    await sendNotification(message);
  },
  
  '👨‍💻 Com Desenvolvimento': async (card) => {
    console.log(`👨‍💻 Processando card "${card.name}" na lista Com Desenvolvimento`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addLabel(card.id, 'Desenvolvimento');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '👨‍💻 Em desenvolvimento.');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const message = formatMessage(
      '👨‍💻 EM DESENVOLVIMENTO',
      `📌 <b>Card:</b> ${card.name}\n💻 <b>Status:</b> Em desenvolvimento\n🔧 <b>Ação:</b> Codificando`,
      '👨‍💻'
    );
    await sendNotification(message);
  },
  
  '⏳ Aguardando Cliente': async (card) => {
    console.log(`⏳ Processando card "${card.name}" na lista Aguardando Cliente`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addLabel(card.id, 'Cliente');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '⏳ Aguardando retorno do cliente.');
    
    const message = formatMessage(
      '⏳ AGUARDANDO CLIENTE',
      `📌 <b>Card:</b> ${card.name}\n👤 <b>Cliente:</b> Aguardando retorno\n⏰ <b>Status:</b> Pendente`,
      '⏳'
    );
    await sendNotification(message);
  },
  
  '🚧 Impedimentos': async (card) => {
    console.log(`🚧 Processando card "${card.name}" na lista Impedimentos`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addLabel(card.id, 'Bloqueado');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '🚧 Card bloqueado por impedimento.');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const message = formatMessage(
      '🚨 ALERTA: IMPEDIMENTO',
      `📌 <b>Card:</b> ${card.name}\n🚧 <b>Status:</b> Bloqueado\n⚠️ <b>Ação:</b> Necessário desbloquear`,
      '🚨'
    );
    await sendNotification(message);
  },
  
  '📝 Tarefas Internas': async (card) => {
    console.log(`📝 Processando card "${card.name}" na lista Tarefas Internas`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addLabel(card.id, 'Interno');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addComment(card.id, '📝 Tarefa interna.');
    
    const message = formatMessage(
      '📝 TAREFA INTERNA',
      `📌 <b>Card:</b> ${card.name}\n🏢 <b>Tipo:</b> Interna\n📋 <b>Status:</b> Em andamento`,
      '📝'
    );
    await sendNotification(message);
  },
  
  '✅ Concluído': async (card) => {
    console.log(`✅ Processando card "${card.name}" na lista Concluído`);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const checklists = await trelloApi(`/cards/${card.id}/checklists`);
      for (const checklist of checklists.data) {
        for (const item of checklist.checkItems) {
          await new Promise(resolve => setTimeout(resolve, 500));
          await trelloApi(`/cards/${card.id}/checkItem/${item.id}`, 'PUT', { state: 'complete' });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      await addComment(card.id, '✅ Card concluído com sucesso!');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const message = formatMessage(
        '✅ CARD CONCLUÍDO',
        `📌 <b>Card:</b> ${card.name}\n🎯 <b>Status:</b> Finalizado\n✅ <b>Checklist:</b> Completo`,
        '✅'
      );
      await sendNotification(message);
    } catch (error) {
      console.error('❌ Erro ao concluir checklist:', error.message);
    }
  }
};

// ============ WEBHOOK ============
app.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Webhook recebido:', req.body.action?.type);
    
    const { action } = req.body;
    
    const processCard = async (card, eventType, listName, cardId) => {
      // Usar o cardId real para o cache
      const cacheKey = `${cardId}-${listName}`;
      const now = Date.now();
      
      // Verificar se já processou este card nesta lista
      if (processedCards.has(cacheKey)) {
        const lastProcessed = processedCards.get(cacheKey);
        if (now - lastProcessed < CACHE_TTL) {
          console.log(`⏭️ Ignorando duplicado: "${card.name}" na lista "${listName}"`);
          return false; // Não processar
        }
      }
      
      // Marcar como processado
      processedCards.set(cacheKey, now);
      console.log(`✅ Processando: "${card.name}" na lista "${listName}"`);
      return true; // Processar
    };
    
    // CRIAR CARD
    if (action?.type === 'createCard' && action?.data?.card) {
      const card = action.data.card;
      const listAfter = action?.data?.list;
      const listName = listAfter?.name || 'Desconhecida';
      
      console.log(`📋 Card criado: "${card.name}" na lista "${listName}"`);
      const shouldProcess = await processCard(card, 'Card criado', listName, card.id);
      
      if (shouldProcess) {
        await actions[listName]?.(card);
      }
    }
    
    // MOVER CARD
    if (action?.type === 'updateCard' && action?.data?.card) {
      const card = action.data.card;
      const listAfter = action?.data?.listAfter;
      const listBefore = action?.data?.listBefore;
      
      // Só processa se mudou de lista
      if (listAfter && listBefore && listAfter.id !== listBefore.id) {
        const listName = listAfter.name;
        console.log(`📋 Card movido: "${card.name}" -> "${listName}"`);
        console.log(`📋 De: "${listBefore.name}" -> Para: "${listAfter.name}"`);
        
        const shouldProcess = await processCard(card, 'Card movido', listName, card.id);
        
        if (shouldProcess) {
          // Buscar o card completo antes de processar
          try {
            const fullCard = await getCard(card.id);
            await actions[listName]?.(fullCard);
          } catch (error) {
            console.error(`❌ Erro ao processar card "${card.name}":`, error.message);
          }
        }
      } else {
        console.log(`⏭️ Ignorando updateCard sem mudança de lista para "${card.name}"`);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error.message);
    if (error.response) {
      console.error('❌ Detalhes:', error.response.data);
    }
    res.sendStatus(500);
  }
});

// ============ LIMPAR CACHE ============
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedCards) {
    if (now - timestamp > CACHE_TTL) {
      processedCards.delete(key);
    }
  }
}, 5000);

// ============ CRON - VERIFICAR PRAZOS ============
cron.schedule('0 8 * * *', async () => {
  console.log('🔄 Verificando prazos...');
  
  try {
    const { data: cards } = await trelloApi(`/boards/${TRELLO.boardId}/cards`);
    const now = new Date();
    const upcoming = [];
    const overdue = [];
    
    for (const card of cards) {
      if (card.due) {
        const dueDate = new Date(card.due);
        const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
          overdue.push(`🔴 ${card.name} (${Math.abs(diffDays)} dias atrás)`);
        } else if (diffDays <= 3) {
          upcoming.push(`⏰ ${card.name} (em ${diffDays} dias)`);
        }
      }
    }
    
    if (overdue.length > 0 || upcoming.length > 0) {
      let content = '';
      if (overdue.length > 0) {
        content += '🚨 VENCIDOS:\n' + overdue.join('\n') + '\n\n';
      }
      if (upcoming.length > 0) {
        content += '⚠️ PRÓXIMOS:\n' + upcoming.join('\n');
      }
      
      const message = formatMessage(
        '📊 RELATÓRIO DE PRAZOS',
        content,
        '📊'
      );
      await sendNotification(message);
    }
  } catch (error) {
    console.error('❌ Erro ao verificar prazos:', error.message);
  }
});

// ============ ROUTES ============
app.get('/', (req, res) => {
  res.json({ 
    status: 'Trello Automation API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      webhook: 'POST /webhook',
      testNotification: 'POST /test-notification'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.post('/test-notification', async (req, res) => {
  try {
    const message = formatMessage(
      '🧪 TESTE DE NOTIFICAÇÃO',
      '✅ Sistema funcionando corretamente!\n📌 Todos os serviços estão ativos.',
      '🧪'
    );
    await sendNotification(message);
    res.json({ 
      success: true, 
      message: 'Notificação enviada com sucesso!' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============ SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📋 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📨 Test notification: http://localhost:${PORT}/test-notification`);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
});
