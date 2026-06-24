// Serverless function for Vercel with Gemini API Key Rotation
// Supports fallback to multiple keys if one hits Rate Limit (429)

export default async function handler(req, res) {
  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Ambil Data Body
  const { messages, contents, model } = req.body;
  const rawMessages = messages || contents;

  if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
    return res.status(400).json({
      error: 'Body "messages" atau "contents" is required'
    });
  }

  const normalizeMessage = message => {
    const role = message.role === 'model'
      ? 'assistant'
      : message.role === 'assistant' || message.role === 'system'
      ? message.role
      : 'user';

    const getText = item => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item !== null) return item.text || item.content || '';
      return '';
    };

    const contentText = (() => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) return message.content.map(getText).join(' ');
      if (Array.isArray(message.parts)) return message.parts.map(getText).join(' ');
      if (typeof message.text === 'string') return message.text;
      return '';
    })();

    return {
      role,
      content: contentText.trim()
    };
  };

  const normalizedMessages = rawMessages
    .map(normalizeMessage)
    .filter(msg => msg.content && msg.content.length > 0);

  if (normalizedMessages.length === 0) {
    return res.status(400).json({
      error: 'No valid messages found in body'
    });
  }

  // 3. Ambil semua API Key Gemini dari ENV
  const keysString =
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    '';

  const apiKeys = keysString
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

  // Default model
  const GEMINI_MODEL = model || process.env.GEMINI_MODEL || 'gemini-2.5flash';

  if (apiKeys.length === 0) {
    console.error('Missing GEMINI_API_KEYS or GEMINI_API_KEY environment variable');

    return res.status(500).json({
      error: 'Server configuration error: No Gemini API keys found.',
      details: 'Set GEMINI_API_KEYS or GEMINI_API_KEY in the environment.'
    });
  }

  // 4. Logika Rotasi Key
  let lastError = null;
  let success = false;
  let finalData = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i].trim();

    try {
      // console.log(`[Attempt] Using Gemini Key Index: ${i}`);

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentKey}`
          },
          body: JSON.stringify({
            model: GEMINI_MODEL,
            messages: normalizedMessages,
            temperature: 0.7
          })
        }
      );

      // SUCCESS
      if (response.ok) {
        finalData = await response.json();
        success = true;
        break;
      }

      // RATE LIMIT
      if (response.status === 429) {
        console.warn(
          `[Limit] Key ke-${i + 1} habis (429). Mencoba key berikutnya...`
        );

        lastError = {
          status: 429,
          message: 'Rate limit exceeded'
        };

        continue;
      }

      // ERROR LAIN
      const errorData = await response.json();

      console.error(`[API Error] Key ${i}:`, errorData);

      lastError = {
        status: response.status,
        details: errorData
      };

      break;

    } catch (error) {
      console.error(`[Network Error] Key ${i}:`, error);

      lastError = {
        status: 500,
        message: 'Internal Network Error'
      };

      // lanjut coba key berikutnya
    }
  }

  // 5. Response Akhir
  if (success && finalData) {
    return res.status(200).json(finalData);
  }

  return res.status(lastError?.status || 500).json({
    error: 'Generation failed',
    message: 'Semua Gemini API Key sedang sibuk atau bermasalah.',
    details: lastError
  });
}
