import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function searchWeb(query) {
  if (!process.env.SERPER_API_KEY) return '';
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'ru', hl: 'ru', num: 3 })
    });
    const data = await res.json();
    if (data.organic && data.organic.length > 0) {
      return data.organic.map(item => `${item.title}: ${item.snippet}`).join('\n');
    }
  } catch (e) {
    console.error('Serper error:', e);
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Alice webhook is active');
  }

  const { request, session, version } = req.body;
  const command = request?.command || request?.original_utterance || '';

  // При первом запуске навыка
  if (session?.new || !command.trim()) {
    return res.status(200).json({
      version,
      session,
      response: {
        text: 'Привет! Я прокачанная версия Алисы на базе Gemini. О чем поговорим или что найти в интернете?',
        end_session: false
      }
    });
  }

  try {
    // 1. Поиск актуальной инфы через Serper
    const searchContext = await searchWeb(command);

    // 2. Системный промпт для Gemini
    const systemPrompt = `Ты умный голосовой помощник для колонки Яндекс Алиса.
Отвечай кратко, емко, естественным языком для голоса. 
Не используй сложные списки, markdown-разметку или спецсимволы, так как ответ будет озвучен.
Если предоставлен контекст из веб-поиска, используй его для ответа на актуальные вопросы.
Контекст из интернета:
${searchContext}`;

    // 3. Запрос к Gemini
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: `${systemPrompt}\n\nВопрос пользователя: ${command}` }] }
      ]
    });

    const replyText = response.text || 'Извините, не удалось сформировать ответ.';

    return res.status(200).json({
      version,
      session,
      response: {
        text: replyText.trim(),
        end_session: false
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(200).json({
      version,
      session,
      response: {
        text: 'Произошла ошибка при обработке запроса. Попробуйте еще раз.',
        end_session: false
      }
    });
  }
}
