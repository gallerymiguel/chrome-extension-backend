// tests/usage.test.js
const request  = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;
let app;
let token;        // will hold JWT for auth header

beforeAll(async () => {
  // spin up in-memory Mongo, point app to it, then load app
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = "devjwt1234567890devjwt1234567890";       // any string is fine for JWT verify
  app = require("../src/index");
});

afterAll(async () => {
  await mongoose.connection.close();
  await mongo.stop();
});

describe("Usage-count flow", () => {
  test("register → increment → query usageCount", async () => {
    /* 1️⃣ Register a new user */
    const registerRes = await request(app)
      .post("/graphql")
      .send({
        query: `
          mutation ($email:String!, $password:String!) {
            register(email:$email, password:$password)
          }
        `,
        variables: { email: "usage@test.com", password: "Strong123!" },
      });

    expect(registerRes.status).toBe(200);
    token = registerRes.body.data.register;              // raw JWT

    /* helper to call GraphQL with auth header */
    const gql = (body) =>
      request(app)
        .post("/graphql")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

    /* 2️⃣ Initial getUsageCount should be 0 */
    const init = await gql({ query: `{ getUsageCount }` });
    expect(init.body.data.getUsageCount).toBe(0);

    /* 3️⃣ First increment by 5 */
    const inc1 = await gql({
      query: `mutation { incrementUsage(amount:5) }`,
    });
    expect(inc1.body.data.incrementUsage).toBe(true);

    /* 4️⃣ Second increment by 10 */
    const inc2 = await gql({
      query: `mutation { incrementUsage(amount:10) }`,
    });
    expect(inc2.body.data.incrementUsage).toBe(true);

    /* 5️⃣ Final count should be 15 */
    const final = await gql({ query: `{ getUsageCount }` });
    expect(final.body.data.getUsageCount).toBe(15);
  });
});
