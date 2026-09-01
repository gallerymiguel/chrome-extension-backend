const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../src/models/User");

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

afterEach(async () => {
  await User.deleteMany({});
  jest.resetAllMocks();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await mongoose.connection.close();
  await mongo.stop();
});

describe("POST /api/ai/summarize", () => {
  async function createAuthHeader(userFields = {}) {
    const user = await User.create({
      email: userFields.email || "summary@test.com",
      password: "Strong123!",
      subscriptionStatus: "inactive",
      usageCount: userFields.usageCount || 0,
      resetDate: userFields.resetDate,
    });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    return { authHeader: `Bearer ${token}`, user };
  }

  test("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/ai/summarize")
      .send({ transcript: "A useful transcript." });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", "Bearer invalid-token")
      .send({ transcript: "A useful transcript." });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 400 when transcript is missing", async () => {
    const { authHeader } = await createAuthHeader();
    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", authHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("transcript is required");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 500 when OPENAI_API_KEY is missing", async () => {
    const { authHeader } = await createAuthHeader();
    delete process.env.OPENAI_API_KEY;

    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", authHeader)
      .send({ transcript: "A useful transcript." });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("OPENAI_API_KEY is not configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 400 when transcript is too long", async () => {
    const { authHeader } = await createAuthHeader();
    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", authHeader)
      .send({ transcript: "x".repeat(50001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("transcript must be 50000 characters or fewer");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 403 when usage limit would be exceeded", async () => {
    const { authHeader } = await createAuthHeader({
      email: "limit@test.com",
      usageCount: 7501,
    });

    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", authHeader)
      .send({ transcript: "A useful transcript." });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USAGE_LIMIT_REACHED");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns structured summary JSON from OpenAI output", async () => {
    const { authHeader, user } = await createAuthHeader();
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

    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", authHeader)
      .send({
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
    const updatedUser = await User.findById(user._id);
    expect(updatedUser.usageCount).toBe(1000);
  });

  test("does not increment usage when OpenAI returns a non-2xx response", async () => {
    const { authHeader, user } = await createAuthHeader({
      email: "openai-failure@test.com",
      usageCount: 2000,
    });

    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: { message: "Rate limit reached" },
      }),
    });

    const res = await request(app)
      .post("/api/ai/summarize")
      .set("Authorization", authHeader)
      .send({ transcript: "A useful transcript." });

    const updatedUser = await User.findById(user._id);

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Rate limit reached");
    expect(updatedUser.usageCount).toBe(2000);
  });
});
