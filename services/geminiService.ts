
import { GoogleGenAI } from "@google/genai";

// Fix: Always use new GoogleGenAI({apiKey: process.env.API_KEY}) directly as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function translateText(
  text: string, 
  targetLang: string, 
  modelName: string = 'gemini-3-flash-preview'
): Promise<string> {
  if (!text.trim()) return '';
  
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: `Translate the following text into ${targetLang}. Provide ONLY the translation without any preamble or quotes: "${text}"`,
      config: {
        temperature: 0.3,
        topP: 0.8,
      }
    });

    return response.text?.trim() || 'Translation failed';
  } catch (error) {
    console.error('Translation error:', error);
    return 'Error in translation service';
  }
}
