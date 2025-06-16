// tests/webhookIdempotency.test.js
const request      = require("supertest");
const mongoose     = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User         = require("../src/models/User");

/* ─── Mock Stripe globally ───────────────────────────────────────── */
const mockSub      = {
  id:                "sub_123",
  current_period_end: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
};
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        type: "customer.subscription.created",
        data: { object: mockSub },
      }),
    },
    customers:      { retrieve: jest.fn().mockResolvedValue({ email: "idempotent@test.com" }) },
    subscriptions:  { retrieve: jest.fn().mockResolvedValue(mockSub) },
  }))
);
/* ─────────────────────────────────────────────────────────────────── */

let mongo, app;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  app   = require("../src/index");
});

afterAll(async () => {
  await mongoose.connection.close();
  await mongo.stop();
});

test("posting the same subscription event twice activates user only once", async () => {
  // 1. Seed an inactive user
  const user = await User.create({
    email: "idempotent@test.com",
    password: "dummy",
    subscriptionStatus: "inactive",
  });

  const postEvent = () =>
    request(app)
      .post("/webhook")
      // bodyParser.raw() wants raw bytes; supertest .send(Buffer)
      .set("Stripe-Signature", "anysig") // signature ignored by mock
      .send(Buffer.from(JSON.stringify({ id: "evt_test" })));

  // 2. First POST → should activate
  const res1 = await postEvent();
  expect(res1.status).toBe(200);

  // 3. Second POST → idempotent; no duplicate change
  const res2 = await postEvent();
  expect(res2.status).toBe(200);

  // 4. Reload user from DB and assert single activation
  const updated = await User.findById(user._id).lean();

  expect(updated.subscriptionStatus).toBe("active");
  expect(updated.resetDate).toBeDefined();

  // optional: createdAt / updatedAt unchanged on 2nd call
  // expect(updated.updatedAt.getTime()).toBeGreaterThan(updated.createdAt.getTime());
});
