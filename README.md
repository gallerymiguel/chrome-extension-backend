# 🎧 Chrome Extension Backend (GraphQL API Server)

This is the backend server for the Chrome Extension that extracts and summarizes video/audio transcripts from YouTube and Instagram. It handles:

- ✅ Whisper transcription via OpenAI
- 🔐 JWT-authenticated user sessions
- 📊 Token-based usage tracking
- 💳 Stripe subscriptions (Pro unlocks Instagram)
- 🧠 GraphQL API for frontend queries/mutations

---

## 🧪 Tech Stack

- Node.js + Express
- Apollo Server (GraphQL)
- MongoDB with Mongoose
- OpenAI Whisper API
- Stripe API (Subscriptions)
- Docker + Render deployment
- GitHub Actions for CI/CD

---

## 🔧 Setup Instructions

### 1. Clone the repo

```bash
git clone https://github.com/your-username/chrome-extension-backend.git
cd chrome-extension-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment variables

Create a `.env` file in the root:

```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
OPENAI_API_KEY=your_openai_key
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PRICE_ID=your_stripe_price_id
CLIENT_URL=http://localhost:5173
```

Make sure `.env` is **excluded** from Git using `.gitignore`.

---

## 🧪 Run Locally

```bash
npm run dev
```

OR with Docker:

```bash
docker build -t whisper-backend .
docker run -p 3000:3000 whisper-backend
```

---

## 🧪 Example Queries

#### `saveMission`

```graphql
mutation SaveMission($input: MissionInput!) {
  saveMission(input: $input) {
    id
    missionName
  }
}
```

#### `getUsageCount`

```graphql
query {
  getUsageCount
}
```

---

## 📦 Folder Structure

```
chrome-extension-backend/
│
├── src/
│   ├── resolvers/       # GraphQL resolvers (auth, stripe, transcription)
│   ├── typeDefs/        # GraphQL schemas
│   ├── models/          # MongoDB models (User, Mission, etc.)
│   ├── utils/           # Auth, Whisper, Stripe helpers
│   └── index.js         # Entry point
│
├── .env
├── Dockerfile
├── package.json
└── README.md
```

---

## 🌐 Deployment Checklist

- [ ] Secrets configured in `.env` and Render
- [ ] Docker container builds correctly
- [ ] GraphQL playground is enabled for development only
- [ ] Stripe set to **live mode** with real product price
- [ ] CORS allows frontend domain (`localhost`, `chrome-extension://`, etc.)

---

## 🔐 Security Tips

- Never expose `.env` or `uploads/` folder
- Use HTTPS endpoints on production
- Sanitize and validate all user input
- Only store token estimates, not raw transcripts

---

## 👨‍💻 Author

Built by [@Miguel Urdiales](https://github.com/gallerymiguel)

---

## 🧼 License

MIT — free to use, fork, and improve
