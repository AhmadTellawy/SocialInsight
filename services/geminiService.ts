
import { GoogleGenAI, Type } from "@google/genai";

export interface GeneratedSurveyData {
  title: string;
  description: string;
  question: string;
  options: string[];
}

export const generateSurveyFromTopic = async (topic: string): Promise<GeneratedSurveyData | null> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a catchy survey based on the topic: "${topic}". 
      It should have a title, a short description, one main engaging question, and 3-4 varied options for a poll.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            question: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["title", "description", "question", "options"],
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text) as GeneratedSurveyData;

  } catch (error) {
    console.error("Error generating survey:", error);
    return null;
  }
};
