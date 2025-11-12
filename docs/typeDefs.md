
### Type Reference

**User**
- Purpose: represents an account and quota state
- Fields:
  - `_id` ID! — database identifier
  - `email` String! — login email
  - `subscriptionStatus` String — plan state (e.g., FREE, ACTIVE, CANCELED)
  - `usageCount` Int — tokens used in current period (default 0)
- Auth: returned only for authenticated requests
- Data: `users` collection/table (`usageCount` default 0)

**PaymentLog**
- Purpose: records donations or subscription events
- Fields: `_id`, `type`, `amount`, `timestamp`
- Data: `payment_logs` collection/table

### Query Reference

**checkSubscriptionStatus: Boolean!**
- Purpose: quick check that a user is allowed to use transcription features
- Returns: true if subscription or free tier is eligible
- Auth: requires JWT in `Authorization: Bearer <token>`
- Resolver: `resolvers/queries/checkSubscriptionStatus`
- Errors: unauthorized if no token

**getUsageCount: Int!**
- Purpose: used by Whisper server before transcription to enforce quota
- Returns: current usage count for the authenticated user
- Auth: requires JWT
- Resolver: `resolvers/queries/getUsageCount`
- Errors: unauthorized if no token, returns 0 if missing field

### Mutation Reference

**incrementUsage(amount: Int!): Boolean!**
- Purpose: add tokens after a successful transcription
- Side effects: increments `users.usageCount` by `amount`
- Auth: requires JWT
- Resolver: `resolvers/mutations/incrementUsage`
- Errors: unauthorized, input validation
- Notes: called only after Whisper success path

**register(email, password): String!**
- Purpose: create user and return JWT
- Auth: public
- Resolver: `resolvers/mutations/register`
- Errors: email already exists, weak password
- Notes: initialize `usageCount = 0`, set `subscriptionStatus = "FREE"`

**login(email, password): String!**
- Purpose: authenticate and return JWT
- Auth: public
- Resolver: `resolvers/mutations/login`
- Errors: invalid credentials

**startSubscription: String!**
- Purpose: begin paid plan and return client secret or session URL
- Auth: requires JWT
- Resolver: `resolvers/mutations/startSubscription`
- Notes: integrates with Stripe

**cancelSubscription: String!**
- Purpose: cancel current plan
- Auth: requires JWT
- Resolver: `resolvers/mutations/cancelSubscription`

**donate(amount: Float!): String!**
- Purpose: one-time support payment
- Auth: public or JWT (your policy)
- Resolver: `resolvers/mutations/donate`
- Side effects: creates `PaymentLog`

**requestPasswordReset(email): String!**
- Purpose: send reset email with token
- Auth: public
- Resolver: `resolvers/mutations/requestPasswordReset`

**resetPassword(token, newPassword): String!**
- Purpose: set new password from a valid token
- Auth: public
- Resolver: `resolvers/mutations/resetPassword`

### Resolver Map

| Operation | Resolver path | Data source | Auth | Notes |
|---|---|---|---|---|
| checkSubscriptionStatus | `resolvers/queries/checkSubscriptionStatus` | users, payments | JWT | returns boolean |
| getUsageCount | `resolvers/queries/getUsageCount` | users | JWT | defaults to 0 |
| incrementUsage | `resolvers/mutations/incrementUsage` | users | JWT | atomic increment |
| register | `resolvers/mutations/register` | users | none | set defaults |
| login | `resolvers/mutations/login` | users | none | returns JWT |
| startSubscription | `resolvers/mutations/startSubscription` | Stripe, users | JWT | plan activation |
| cancelSubscription | `resolvers/mutations/cancelSubscription` | Stripe, users | JWT | plan end |
| donate | `resolvers/mutations/donate` | Stripe, payment_logs | varies | creates log |
| requestPasswordReset | `resolvers/mutations/requestPasswordReset` | users, mailer | none | token creation |
| resetPassword | `resolvers/mutations/resetPassword` | users | none | token verification |

### Auth and Context

- JWT required for: `checkSubscriptionStatus`, `getUsageCount`, `incrementUsage`, `startSubscription`, `cancelSubscription`
- `context` provides: `userId`, `email`, `role`
- Middleware: token parsed from `Authorization` header

### Error Contract

All resolvers return typed data on success. On failure:
```json
{ "error": { "code": "UNAUTHORIZED", "message": "Login required." } }