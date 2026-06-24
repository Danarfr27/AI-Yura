// Serverless function for Vercel with OpenAI API Key Rotation Strategy
// Supports fallback to multiple keys if one hits Rate Limit (429)

export default async function handler(req, res) {
  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Ambil Data Body
  const { messages, model } = req.body;

  if (!messages) {
    return res.status(400).json({
      error: 'Body "messages" is required'
    });
  }

  // 3. Ambil semua API Key OpenAI dari ENV
  // Format ENV:
  // OPENAI_API_KEYS=sk-xxx,sk-yyy,sk-zzz

  const keysString =
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    '';

  const apiKeys = keysString
    .split(',')
    .filter(k => k.trim().length > 0);

  // Default model
  const GEMINI_MODEL = model || process.env.GEMINI_MODEL || 'gemini-2.5flash';

  if (apiKeys.length === 0) {
    console.error('Missing GEMINI_API_KEYS environment variable');

    return res.status(500).json({
      error: 'Server configuration error: No API keys found.'
    });
  }

  // 4. Logika Rotasi Key
  let lastError = null;
  let success = false;
  let finalData = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i].trim();

    try {
      // console.log(`[Attempt] Using OpenAI Key Index: ${i}`);

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
            messages,
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
    message: 'Semua OpenAI API Key sedang sibuk atau bermasalah.',
    details: lastError
  });
}
