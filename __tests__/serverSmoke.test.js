// tests/serverSmoke.test.js
const mongoose = require("mongoose");
const app = require("../src/index");        // still needed for future tests

beforeAll(async () => {
  // Wait until Mongoose reports connected
  if (mongoose.connection.readyState === 0) {
    // ensure we point to a test DB (set MONGO_URI_TEST in env or here)
    await mongoose.connect(process.env.MONGO_URI_TEST, {
      // these options can now be omitted in driver v7, but fine to keep
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase(); // keep test DB clean
  await mongoose.connection.close();
});

test("Express app boots for tests", () => {
  expect(app).toBeDefined();
});
