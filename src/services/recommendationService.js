import { prisma } from "../lib/prisma.js";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function getAiRecommendations(userId) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable");
  }

  // 1. Load selected user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tags: true,
      description: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // 2. Load all mentors
  const mentors = await prisma.user.findMany({
    where: { role: "MENTOR" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tags: true,
      description: true,
    },
  });

  if (mentors.length === 0) {
    throw new Error("No mentors found in the database");
  }

  // 3. Prepare structured prompt
  const userTagsStr =
    user.tags && user.tags.length > 0 ? user.tags.join(", ") : "None";
  const userDescStr = user.description || "None";

  const mentorsData = mentors.map((m) => {
    return {
      mentorId: m.id,
      name: m.name,
      tags: m.tags || [],
      description: m.description || "",
    };
  });

  const prompt = `You are an expert matching system. Recommend mentors for the user below.

User Profile:
- ID: ${user.id}
- Name: ${user.name}
- Tags: [${userTagsStr}]
- Description: "${userDescStr}"

List of Mentors:
${JSON.stringify(mentorsData, null, 2)}

Compare the User's tags and description with each Mentor's tags and description. Calculate a matching score from 0 to 100 for each mentor and write a specific 1-2 sentence reason for the score. Higher scores indicate better alignment.

Return ONLY a JSON object conforming exactly to this schema:
{
  "recommendations": [
    {
      "mentorId": "...",
      "score": 90,
      "reason": "..."
    }
  ]
}

No explanations outside of the JSON. Do not wrap the JSON output in markdown blocks like \`\`\`json. Return valid JSON only.`;

  // 4. Send prompt to Gemini API with retry logic
  let attempts = 2;
  let lastError = null;

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text;

      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const parsed = JSON.parse(text);

      if (!Array.isArray(parsed.recommendations)) {
        throw new Error("Invalid response schema");
      }

      const recommendationsWithMentorDetails = parsed.recommendations.map(
        (rec) => {
          const mentorObj = mentors.find((m) => m.id === rec.mentorId);

          return {
            mentorId: rec.mentorId,
            score: Number(rec.score) || 0,
            reason: rec.reason || "Matched by AI.",
            mentor: mentorObj || {
              id: rec.mentorId,
              name: "Unknown Mentor",
              tags: [],
              description: "",
            },
          };
        },
      );

      recommendationsWithMentorDetails.sort((a, b) => b.score - a.score);

      return recommendationsWithMentorDetails;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  throw lastError || new Error("Failed to get recommendations from Gemini API");
}
