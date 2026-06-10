const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;
let app;
const originalFetch = global.fetch;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = "devjwt1234567890devjwt1234567890";
  app = require("../src/index");
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await mongoose.connection.close();
  await mongo.stop();
});

describe("POST /api/ai/summarize", () => {
  test("returns 400 when transcript is missing", async () => {
    const res = await request(app).post("/api/ai/summarize").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("transcript is required");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 500 when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const res = await request(app)
      .post("/api/ai/summarize")
      .send({ transcript: "A useful transcript." });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("OPENAI_API_KEY is not configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 400 when transcript is too long", async () => {
    const res = await request(app)
      .post("/api/ai/summarize")
      .send({ transcript: "x".repeat(50001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("transcript must be 50000 characters or fewer");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns structured summary JSON from OpenAI output", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          summary: "Short summary.",
          keyPoints: ["Point one"],
          actionItems: ["Do the thing"],
          warnings: ["Transcript is brief"],
        }),
      }),
    });

    const res = await request(app).post("/api/ai/summarize").send({
      transcript: "A useful transcript.",
      title: "Example video",
      platform: "Instagram",
      startTime: "00:00",
      endTime: "01:00",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      summary: "Short summary.",
      keyPoints: ["Point one"],
      actionItems: ["Do the thing"],
      warnings: ["Transcript is brief"],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-openai-key",
          "Content-Type": "application/json",
        }),
      })
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe(
      "gpt-5-mini"
    );
  });
});
