const mongoose = require("mongoose");
const connectDB = require("../src/config/db");

describe("test database safety", () => {
  const originalMongoUri = process.env.MONGO_URI;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.MONGO_URI = originalMongoUri;
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  test.each([
    ["remote SRV URI", "mongodb+srv://user:pass@example.mongodb.net/db"],
    ["remote standard URI", "mongodb://example.com:27017/test"],
  ])("refuses %s when NODE_ENV is test", async (_label, uri) => {
    const connectSpy = jest.spyOn(mongoose, "connect").mockResolvedValue();
    process.env.NODE_ENV = "test";
    process.env.MONGO_URI = uri;

    await expect(connectDB()).rejects.toThrow(
      "Refusing to connect to non-local MongoDB during tests"
    );
    expect(connectSpy).not.toHaveBeenCalled();
  });

  test("allows localhost MongoDB URIs when NODE_ENV is test", async () => {
    const connectSpy = jest.spyOn(mongoose, "connect").mockResolvedValue();
    process.env.NODE_ENV = "test";
    process.env.MONGO_URI = "mongodb://localhost:27017/test";

    await expect(connectDB()).resolves.toBeUndefined();
    expect(connectSpy).toHaveBeenCalledWith("mongodb://localhost:27017/test", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });
});
