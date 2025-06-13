// tests/register.test.js
const request  = require("supertest");
const mongoose = require("mongoose");
const User     = require("../src/models/User");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;
let app;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();      // so connectDB() uses in-mem DB
  app = require("../src/index");               // load Express after env is set
});

afterEach(async () => {
  // clean up between tests
  const collections = await mongoose.connection.db.collections();
  for (const col of collections) await col.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.close();
  await mongo.stop();
});

test("new user can register and gets JWT", async () => {
  const variables = {
    email:    "fresh@example.com",
    password: "StrongPass1!",
  };

  const res = await request(app)
    .post("/graphql")
    .send({
      query: `
        mutation Register($email:String!, $password:String!) {
          register(email: $email, password: $password)  # ← change if name differs
        }
      `,
      variables,
    });

  // 1️⃣ HTTP + GraphQL basic checks
  expect(res.status).toBe(200);
  expect(res.body.errors).toBeUndefined();
  expect(res.body.data.register).toMatch(/^ey/);    // assuming it returns a token

  // 2️⃣ Confirm the user is in DB
  const user = await User.findOne({ email: variables.email }).lean();
  expect(user).toBeTruthy();
  expect(user.subscriptionStatus).toBe("inactive");
  // password should be hashed (not equal to plain text)
  expect(user.password).not.toBe(variables.password);
});
