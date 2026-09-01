// tests/serverSmoke.test.js
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongo;
let app;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.MONGO_URI_TEST = process.env.MONGO_URI;
  app = require("../src/index");
});

afterAll(async () => {
  await mongoose.connection.dropDatabase(); // keep test DB clean
  await mongoose.connection.close();
  await mongo.stop();
});

test("Express app boots for tests", () => {
  expect(app).toBeDefined();
});
