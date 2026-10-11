import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();

// Поддержка входящих JSON-запросов от Яндекса
app.use(express.json());

// Инициализация Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Быстрый веб-поиск через Serper API.
 * Срабатывает только при наличии маркеров актуальности или прямого запроса.
 */
async function fetchSerperSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return '';

  const triggerWords = [
    'погода', 'новости', 'курс', 'сегодня', 'счет', 'матч', 
    'когда', 'сколько стоит', 'цена', 'кто такой', 'что такое',
    'найди', 'поищи', 'в интернете'
  ];

  const lowerQuery = query.toLowerCase();
  const shouldSearch = triggerWords.some(word => lowerQuery.includes(word));
  if (!shouldSearch) return '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2 сек максимум

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
    console.log('[Serper Search Skipped/Timed out]:', err.name);
  }
  return '';
}

/**
 * Основной обработчик запросов протокола Яндекс Диалогов.
 */
async function aliceWebhookHandler(req, res) {
  const { request, session, version, state } = req.body || {};
  const command = (request?.command || request?.original_utterance || '').trim();

  // Достаем историю диалога из session_state без сторонних БД
  const previousHistory = state?.session?.history || [];

  // 1. Первый запуск навыка или пустое обращение
  if (session?.new || !command) {
    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: 'Привет! Я голосовой помощник на базе Gemini. О чем хотите поговорить или что найти?',
        tts: 'Привет! Я голов+ой помощник на базе Gemini. О чём хотите поговорить или что найти?',
        end_session: false
      },
      session_state: {
        history: []
      }
    });
  }

  // 2. Обработка команд завершения сессии
  const exitCommands = ['выход', 'стоп', 'хватит', 'пока', 'отмена'];
  if (exitCommands.includes(command.toLowerCase())) {
    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: 'Всего доброго! Будут вопросы — обращайтесь.',
        end_session: true
      }
    });
  }

  try {
    // 3. Быстрый поиск в сети при необходимости
    const webContext = await fetchSerperSearch(command);

    // 4. Подготовка инструкций для генерации
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let systemPrompt = `Ты персональный умный голосовой ассистент для Яндекс Алисы.
Строгие требования:
- Отвечай кратко, понятно и по делу (максимум 2-3 коротких предложения).
- Категорически запрещено использовать разметку Markdown (звездочки, решетки, тире для списков), спецсимволы и смайлы, так как твой ответ читается вслух синтезатором речи.
- Отвечай в разговорном тоне, без лишней вежливости и повторения вопроса.`;

    if (webContext) {
      systemPrompt += `\nАктуальная информация из поисковика:\n${webContext}`;
    }

    // 5. Формирование структуры сообщений с историей
    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Правила понял. Буду отвечать предельно кратко для озвучки голосом.' }] }
    ];

    // Добавляем до 4 последних реплик (2 цикла диалога)
    for (const item of previousHistory.slice(-4)) {
      contents.push({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.text }]
      });
    }

    // Добавляем текущую реплику
    contents.push({
      role: 'user',
      parts: [{ text: command }]
    });

    // 6. Запрос к модели
    const response = await model.generateContent({ contents });
    let answer = response.response.text() || 'Не удалось получить ответ.';

    // Очистка ответа от разметки Markdown для чистой речи
    answer = answer
      .replace(/[*#_`~\[\]\(\)]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    // 7. Обновление истории сессии
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

  } catch (error) {
    console.error('[Service Error]:', error);
    return res.json({
      version: version || '1.0',
      session,
      response: {
        text: 'Произошла небольшая задержка сети. Повторите, пожалуйста, ваш вопрос.',
        end_session: false
      },
      session_state: {
        history: previousHistory
      }
    });
  }
}

// Регистрация endpoints
app.post('/api', aliceWebhookHandler);
app.post('/', aliceWebhookHandler);

// Проверочные GET-эндпоинты (для браузера и пингов)
app.get('/api', (req, res) => res.status(200).send('Alice API endpoint is active!'));
app.get('/', (req, res) => res.status(200).send('Alice Service is running!'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
