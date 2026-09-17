import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large image payloads

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/analyze-image', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Strip data URI prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `Analyze this aerial/satellite image. Identify its real-world geographical location if possible. 
Estimate the exact bounding box (bbox) coordinates [minLon, minLat, maxLon, maxLat]. 
If you are unsure of the exact location, estimate a generic city bounding box.
Return ONLY a valid JSON object in this exact format:
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "bbox": [-74.01, 40.71, -74.00, 40.72],
  "locationName": "City, Country"
}
Do not include markdown blocks or any other text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data
              }
            }
          ]
        }
      ]
    });

    const text = response.text.trim();
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(jsonStr);

    res.json(result);
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Secure Backend server running on port ${PORT}`);
});
