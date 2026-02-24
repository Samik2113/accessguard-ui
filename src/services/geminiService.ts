import { GoogleGenAI, Type } from "@google/genai";
import { ApplicationAccess } from "../types";

// Always use const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeAccessRisks = async (accessList: ApplicationAccess[]) => {
  try {
    const prompt = `Analyze the following user access list for Segregation of Duties (SoD) conflicts or high-risk privilege combinations. 
    Focus on users having both administrative and financial/deployment access.
    
    Access List: ${JSON.stringify(accessList)}
    
    Provide a brief summary of risks and recommendations.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error("Gemini analysis failed", error);
    return "AI Analysis unavailable at this time.";
  }
};