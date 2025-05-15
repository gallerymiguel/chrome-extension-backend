const { gql } = require("apollo-server-express");

module.exports = gql`
  type User {
    _id: ID!
    email: String!
    subscriptionStatus: String
    usageCount: Int
  }

  type PaymentLog {
    _id: ID!
    type: String!
    amount: Float!
    timestamp: String!
  }

  type Query {
    checkSubscriptionStatus: Boolean!
    getUsageCount: Int!
  }

  type Mutation {
    startSubscription: String! # Returns Stripe Checkout URL
    donate(amount: Float!): String! # Returns Stripe Checkout URL
    incrementUsage(amount: Int!): Boolean!
    register(email: String!, password: String!): String! # returns JWT
    login(email: String!, password: String!): String! # returns JWT
  }
`;
