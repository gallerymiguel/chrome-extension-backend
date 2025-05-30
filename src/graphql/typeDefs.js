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
  startSubscription: String!
  donate(amount: Float!): String!
  incrementUsage(amount: Int!): Boolean!
  register(email: String!, password: String!): String!
  login(email: String!, password: String!): String!

  # 🆕 Password reset mutations
  requestPasswordReset(email: String!): String!
  resetPassword(token: String!, newPassword: String!): String!
}

`;
