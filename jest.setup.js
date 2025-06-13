/* eslint-env jest */
jest.mock("stripe");

// Add ONE safe, dummy secret for every test file:
process.env.JWT_SECRET = "devjwt1234567890devjwt1234567890";   // ≥32 chars keeps libs happy