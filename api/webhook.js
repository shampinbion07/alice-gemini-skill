import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

app.get('/', (req, res) => {
  res.send('Alice webhook is active');
});

app.post('/', async (req, res) => {
  const { request, session, version } = req.body;
  const command = request?.command || request?.original_utterance || '';

  // Приветствие при старте навыка
  if (session?.new || !command.trim()) {
    return res.json({
      version,
      session,
      response: {
        text: 'Привет! Я прокачанная версия Алисы на базе Gemini. О чем поговорим или что найти в интернете?',
        end_session: false
      }
    });
  }

  try {
    const searchContext = await searchWeb(command);

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const systemPrompt = `Ты умный голосовой помощник для колонки Яндекс Алиса.
Отвечай кратко, емко, естественным разговорным языком для голоса. 
Не используй сложные списки, markdown-разметку (**жирный**, звездочки) или спецсимволы, так как твой ответ будет озвучен голосом.
Если предоставлен контекст из веб-поиска, используй его для ответа на актуальные вопросы.
Контекст из интернета:
${searchContext}`;

    const prompt = `${systemPrompt}\n\nВопрос пользователя: ${command}`;
    const result = await model.generateContent(prompt);
    const replyText = result.response.text();

    return res.json({
      version,
      session,
      response: {
        text: replyText ? replyText.trim() : 'Извините, не удалось сформировать ответ.',
        end_session: false
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return res.json({
      version,
      session,
      response: {
        text: 'Произошла ошибка при обработке запроса. Попробуйте еще раз.',
        end_session: false
      }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
