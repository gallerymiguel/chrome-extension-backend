const express = require("express");

const router = express.Router();

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const MAX_TRANSCRIPT_CHARS =
  Number.parseInt(process.env.MAX_TRANSCRIPT_CHARS, 10) || 50000;

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim());
}

function normalizeSummaryPayload(value) {
  return {
    summary: typeof value?.summary === "string" ? value.summary : "",
    keyPoints: normalizeStringArray(value?.keyPoints),
    actionItems: normalizeStringArray(value?.actionItems),
    warnings: normalizeStringArray(value?.warnings),
  };
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const outputContent = data?.output
    ?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text" && content.text);

  return outputContent?.text || "";
}

function buildPrompt({ transcript, title, platform, startTime, endTime }) {
  const metadata = [
    title ? `Title: ${title}` : null,
    platform ? `Platform: ${platform}` : null,
    startTime ? `Start time: ${startTime}` : null,
    endTime ? `End time: ${endTime}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Summarize this transcript for a browser extension user.",
    "Produce concise, useful content for the requested fields.",
    "Use warnings for uncertainty, missing context, safety concerns, or unclear transcript sections.",
    metadata ? `\nContext:\n${metadata}` : "",
    `\nTranscript:\n${transcript}`,
  ].join("\n");
}

router.post("/summarize", async (req, res) => {
  const { transcript, title, platform, startTime, endTime } = req.body || {};

  if (typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({ error: "transcript is required" });
  }

  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return res.status(400).json({
      error: `transcript must be ${MAX_TRANSCRIPT_CHARS} characters or fewer`,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
  }

  try {
    const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        input: [
          {
            role: "system",
            content:
              "You summarize transcripts and return only valid JSON that matches the requested schema.",
          },
          {
            role: "user",
            content: buildPrompt({
              transcript,
              title,
              platform,
              startTime,
              endTime,
            }),
          },
        ],
        reasoning: {
          effort: "low",
        },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "transcript_summary",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "keyPoints", "actionItems", "warnings"],
              properties: {
                summary: { type: "string" },
                keyPoints: {
                  type: "array",
                  items: { type: "string" },
                },
                actionItems: {
                  type: "array",
                  items: { type: "string" },
                },
                warnings: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
            strict: true,
          },
        },
      }),
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return res.status(openAiResponse.status).json({
        error: data?.error?.message || "OpenAI summary request failed",
      });
    }

    const outputText = extractOutputText(data);
    const parsed = outputText ? JSON.parse(outputText) : null;

    return res.json(normalizeSummaryPayload(parsed));
  } catch (err) {
    console.error("AI summary error:", err.message);
    return res.status(500).json({ error: "Failed to generate summary" });
  }
});

module.exports = router;
