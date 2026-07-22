// server.js
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
app.use(express.json());

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
      text: message 
    }));
  }
  
  if (NOTIFICATIONS.email) {
    console.log(`📧 Email would be sent: ${message}`);
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
    const { data: labels } = await trelloApi(`/boards/${TRELLO.boardId}/labels`);
    const label = labels.find(l => l.name === labelName);
    if (label) {
      const currentLabels = (await getCard(cardId)).idLabels || [];
      if (!currentLabels.includes(label.id)) {
        await trelloApi(`/cards/${cardId}/idLabels`, 'POST', { value: label.id });
        console.log(`✅ Etiqueta "${labelName}" adicionada`);
      }
    } else {
      console.log(`⚠️ Etiqueta "${labelName}" não encontrada`);
    }
  } catch (error) {
    console.error(`Erro ao adicionar etiqueta "${labelName}":`, error.message);
  }
};

const removeLabel = async (cardId, labelName) => {
  try {
    const card = await getCard(cardId);
    const { data: labels } = await trelloApi(`/boards/${TRELLO.boardId}/labels`);
    const label = labels.find(l => l.name === labelName);
    if (label && card.idLabels?.includes(label.id)) {
      await trelloApi(`/cards/${cardId}/idLabels/${label.id}`, 'DELETE');
      console.log(`✅ Etiqueta "${labelName}" removida`);
    }
  } catch (error) {
    console.error(`Erro ao remover etiqueta "${labelName}":`, error.message);
  }
};

// ============ ACTIONS ============
const actions = {
  '📥 Entrada': async (card) => {
    console.log(`📥 Processando card "${card.name}" na lista Entrada`);
    await addLabel(card.id, 'Novo');
    await updateCard(card.id, { 
      due: new Date(Date.now() + 10 * 86400000).toISOString() 
    });
    await trelloApi(`/cards/${card.id}/checklists`, 'POST', { 
      name: 'Checklist Padrão',
      idCard: card.id
    });
    await addComment(card.id, '📥 Card criado com checklist padrão e prazo de 10 dias.');
    const colors = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'pink'];
    await updateCard(card.id, { 
      cover: { color: colors[Math.floor(Math.random() * colors.length)] } 
    });
    await sendNotification(`📥 Novo card criado: "${card.name}" com prazo de 10 dias`);
  },
  
  '🔥 Para Tratar Hoje': async (card) => {
    console.log(`🔥 Processando card "${card.name}" na lista Para Tratar Hoje`);
    await updateCard(card.id, { due: new Date().toISOString() });
    await addComment(card.id, '🔥 Este card deve ser tratado hoje!');
    await sendNotification(`🔥 Card "${card.name}" precisa ser tratado hoje!`);
  },
  
  '🛠️ Em Atendimento': async (card) => {
    console.log(`🛠️ Processando card "${card.name}" na lista Em Atendimento`);
    await removeLabel(card.id, 'Novo');
    await addLabel(card.id, 'Em Atendimento');
    await addComment(card.id, '🛠️ Em atendimento agora.');
  },
  
  '👨‍💻 Com Desenvolvimento': async (card) => {
    console.log(`👨‍💻 Processando card "${card.name}" na lista Com Desenvolvimento`);
    await addLabel(card.id, 'Desenvolvimento');
    await addComment(card.id, '👨‍💻 Em desenvolvimento.');
    await sendNotification(`👨‍💻 Card "${card.name}" entrou em desenvolvimento.`);
  },
  
  '⏳ Aguardando Cliente': async (card) => {
    console.log(`⏳ Processando card "${card.name}" na lista Aguardando Cliente`);
    await addLabel(card.id, 'Cliente');
    await addComment(card.id, '⏳ Aguardando retorno do cliente.');
  },
  
  '🚧 Impedimentos': async (card) => {
    console.log(`🚧 Processando card "${card.name}" na lista Impedimentos`);
    await addLabel(card.id, 'Bloqueado');
    await addComment(card.id, '🚧 Card bloqueado por impedimento.');
    await sendNotification(`🚨 ALERTA: Card "${card.name}" está bloqueado!`);
  },
  
  '📝 Tarefas Internas': async (card) => {
    console.log(`📝 Processando card "${card.name}" na lista Tarefas Internas`);
    await addLabel(card.id, 'Interno');
    await addComment(card.id, '📝 Tarefa interna.');
  },
  
  '✅ Concluído': async (card) => {
    console.log(`✅ Processando card "${card.name}" na lista Concluído`);
    try {
      const checklists = await trelloApi(`/cards/${card.id}/checklists`);
      for (const checklist of checklists.data) {
        for (const item of checklist.checkItems) {
          await trelloApi(`/cards/${card.id}/checkItem/${item.id}`, 'PUT', { state: 'complete' });
        }
      }
      await addComment(card.id, '✅ Card concluído com sucesso!');
      await sendNotification(`✅ Card "${card.name}" foi concluído!`);
    } catch (error) {
      console.error('Erro ao concluir checklist:', error.message);
    }
  }
};

// ============ WEBHOOK ============
app.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Webhook recebido:', req.body.action?.type);
    
    const { action, model } = req.body;
    
    if (action?.type === 'updateCard' && model?.id) {
      const card = await getCard(model.id);
      const listResponse = await trelloApi(`/lists/${card.idList}`);
      const listName = listResponse.data.name;
      
      console.log(`📋 Card movido para lista: "${listName}"`);
      
      if (actions[listName]) {
        await actions[listName](card);
        console.log(`✅ Automação executada para: ${listName} -> ${card.name}`);
      } else {
        console.log(`ℹ️ Nenhuma automação configurada para a lista: "${listName}"`);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error.message);
    res.sendStatus(500);
  }
});

// ============ CRON (Daily 8AM) ============
cron.schedule('0 8 * * *', async () => {
  console.log('🔄 Executando relatório diário...');
  
  try {
    const { data: cards } = await trelloApi(`/boards/${TRELLO.boardId}/cards`);
    const issues = [];
    const now = new Date();
    
    for (const card of cards) {
      if (card.due && new Date(card.due) < now) {
        issues.push(`🔴 Vencido: ${card.name} (${new Date(card.due).toLocaleDateString('pt-BR')})`);
      }
      if (!card.idMembers?.length) {
        issues.push(`⚠️ Sem responsável: ${card.name}`);
      }
      const lastActivity = new Date(card.dateLastActivity);
      const daysInactive = Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24));
      if (daysInactive >= 7) {
        issues.push(`⏸️ Parado há ${daysInactive} dias: ${card.name}`);
      }
    }
    
    if (issues.length) {
      const report = `📊 RELATÓRIO DIÁRIO\n\n${issues.join('\n')}`;
      await sendNotification(report);
      console.log(`📊 Relatório enviado com ${issues.length} itens`);
    } else {
      console.log('✅ Nenhum problema encontrado no relatório diário');
    }
  } catch (error) {
    console.error('❌ Erro no relatório diário:', error.message);
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
    await sendNotification('🧪 Test notification from Trello Automation');
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
