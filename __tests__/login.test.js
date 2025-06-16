const request           = require("supertest");
const mongoose          = require("mongoose");
const User              = require("../src/models/User");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;   // in-memory server
let app;     // Express app

beforeAll(async () => {
  // 1️⃣ spin up the throw-away Mongo
  mongo = await MongoMemoryServer.create();
  // 2️⃣ point the app's connectDB() to it
  process.env.MONGO_URI = mongo.getUri();      // <- make sure connectDB() uses this env var
  // 3️⃣ now require the app (connectDB runs automatically)
  app = require("../src/index");
  process.env.JWT_SECRET = "devjwt1234567890devjwt1234567890";
});

afterEach(async () => {
  // wipe all collections so each test starts clean
  const collections = await mongoose.connection.db.collections();
  for (const col of collections) await col.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.close();
  await mongo.stop();
});

test("valid login returns JWT", async () => {
  await User.create({
    email: "test@example.com",
    password: "Passw0rd!",            // model hook will hash
    subscriptionStatus: "inactive",
  });

  const res = await request(app)
    .post("/graphql")
    .send({
      query: `
        mutation ($email:String!, $password:String!) {
          login(email: $email, password: $password)
        }
      `,
      variables: { email: "test@example.com", password: "Passw0rd!" },
    });

  expect(res.status).toBe(200);
  expect(res.body.data.login).toMatch(/^ey/);   // token starts with "ey..."
});
