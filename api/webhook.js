import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function fetchSerperSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return '';

  const triggerWords = ['погода', 'новости', 'курс', 'сегодня', 'счет', 'матч', 'цена', 'кто такой', 'что такое'];
  const shouldSearch = triggerWords.some(w => query.toLowerCase().includes(w));
  if (!shouldSearch) return '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1000);

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'ru', hl: 'ru', num: 2 }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    if (data.organic && data.organic.length > 0) {
      return data.organic.map(item => `${item.title}:${item.snippet}`).join('; ');
    }
  } catch (err) {
    console.log('[Serper skipped]:', err.message);
  }
  return '';
}

// Универсальный обработчик для Яндекс Диалогов
async function handleAlice(req, res) {
  console.log('[INCOMING REQUEST METHOD]:', req.method, '[URL]:', req.originalUrl);
  console.log('[REQUEST BODY]:', JSON.stringify(req.body));

  const { request, session, version, state } = req.body || {};
  const command = (request?.command || request?.original_utterance || '').trim();
  const previousHistory = state?.session?.history || [];

  // Ответ на запуск сессии или пинг
  if (session?.new || !command) {
    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: 'Привет! Я прокачанный помощник на базе Gemini. Чем помочь?',
        tts: 'Привет! Я прокачанный помощник на базе Gemini. Чем помочь?',
        end_session: false
      },
      session_state: {
        history: []
      }
    });
  }

  // Команды выхода
  if (['хватит', 'стоп', 'выход', 'пока'].includes(command.toLowerCase())) {
    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: 'До встречи!',
        end_session: true
      }
    });
  }

  try {
    const webContext = await fetchSerperSearch(command);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let systemPrompt = `Ты голосовой ассистент для Яндекс Алисы. Отвечай кратко, без Markdown разметки и спецсимволов. Максимум 2 предложения.`;
    if (webContext) {
      systemPrompt += ` Информация из сети: ${webContext}`;
    }

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Понял, отвечаю кратко голосом.' }] }
    ];

    for (const h of previousHistory.slice(-4)) {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.text }]
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: command }]
    });

    const result = await model.generateContent({ contents });
    let answer = result.response.text() || 'Готово.';
    answer = answer.replace(/[*#_`~\[\]]/g, '').trim();

    const updatedHistory = [
      ...previousHistory.slice(-4),
      { role: 'user', text: command },
      { role: 'assistant', text: answer }
    ];

    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: answer,
        end_session: false
      },
      session_state: {
        history: updatedHistory
      }
    });

  } catch (err) {
    console.error('[Error processing request]:', err);
    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: 'Произошла небольшая задержка, повторите еще раз.',
        end_session: false
      },
      session_state: {
        history: previousHistory
      }
    });
  }
}

// Принимаем POST-запросы на ЛЮБОЙ путь
app.all('*', (req, res, next) => {
  if (req.method === 'POST') {
    return handleAlice(req, res);
  }
  next();
});

// Для проверки через браузер
app.get('*', (req, res) => {
  res.send('Alice service is online!');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
