// tests/refundFlow.test.js
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../src/models/User");

/* ─── Mock Stripe ──────────────────────────────────────────────── */
const mockCustomerId = "cus_refund123";
const mockSubId = "sub_987";

const mockStripeCancel = jest.fn().mockResolvedValue({ status: "canceled" });

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        type: "charge.refunded",
        data: {
          object: { customer: mockCustomerId },
        },
      }),
    },
    subscriptions: {
      list: jest.fn().mockResolvedValue({
        data: [{ id: mockSubId }],
      }),
      // adjust to `.del` if you still use del()
      cancel: mockStripeCancel,
    },
  }))
);
/* ─────────────────────────────────────────────────────────────── */

let mongo, app;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  app = require("../src/index");
});

afterAll(async () => {
  await mongoose.connection.close();
  await mongo.stop();
});

test("charge.refunded cancels sub and marks user as refunded", async () => {
  // 1️⃣ Seed an ACTIVE subscriber
  const user = await User.create({
    email: "refund@test.com",
    password: "dummy",
    subscriptionStatus: "active",
    stripeCustomerId: mockCustomerId,
    resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  // 2️⃣ Post the refund event (raw body for express.raw())
  const res = await request(app)
    .post("/webhook")
    .set("Stripe-Signature", "sig_ignored_in_mock")
    .send(Buffer.from(JSON.stringify({ id: "evt_refund_test" })));

  expect(res.status).toBe(200);

  // 3️⃣ Assert Stripe.cancel (or .del) was called exactly once
  expect(mockStripeCancel).toHaveBeenCalledTimes(1);
  expect(mockStripeCancel).toHaveBeenCalledWith(mockSubId);

  // 4️⃣ Reload user from DB
  const updated = await User.findById(user._id).lean();

  expect(updated.subscriptionStatus).toBe("refunded");
  expect(updated.resetDate).toBeNull();
});
