# ChatGPT Audio/Video Transcriber — Architecture Overview

A full-stack Chrome extension ecosystem that captures video or audio content from YouTube and Instagram, transcribes it with OpenAI Whisper, and integrates with ChatGPT for summarization or translation.

---

## Core Architecture

**Frontend (Chrome Extension)**

* Detects when the user is on a supported platform (YouTube or Instagram).
* Extracts captions if available, or records audio using the browser’s MediaRecorder API.
* Supports manual start/end timestamps for partial transcription.
* Sends `.webm` audio to the Whisper server via `POST /transcribe`.
* Receives the transcript and forwards it to an active ChatGPT tab for processing.
* Manages user login, subscription, and token usage by calling the GraphQL backend.

**Whisper Server (Node.js + Express + FFmpeg)**

* Handles `/transcribe` requests from the extension.
* Converts `.webm` → `.mp3` using `fluent-ffmpeg` and `ffmpeg-static`.
* Optionally slices the clip between start and end timestamps.
* Authenticates requests using a JWT (`Authorization: Bearer <token>`).
* Calls the GraphQL API to:

  * Check user’s current usage count.
  * Increment token usage after transcription.
* Uploads audio to the OpenAI Whisper API for transcription.
* Returns `{ transcript, estimatedTokens }` to the extension.
* Cleans up temporary files and stores debug backups.

**GraphQL Backend (Apollo Server + MongoDB + Stripe + JWT)**

* Central API for user authentication, billing, and usage tracking.
* Provides queries and mutations:

  * `register`, `login`, `getUsageCount`, `incrementUsage`,
  * `startSubscription`, `cancelSubscription`, `donate`,
  * `requestPasswordReset`, `resetPassword`.
* Uses **MongoDB** to store users and usage counters.
* Handles **Stripe Checkout** sessions for subscriptions and donations.
* Runs **monthly usage reset logic** via `utils/limiter.js`.
* Sends password reset emails using **Nodemailer (Yahoo)**.
* JWTs authenticate users across the Whisper server and Chrome extension.

**OpenAI Whisper API**

* Performs actual speech-to-text transcription from `.mp3`.
* Returns transcript text which the Whisper server forwards to the frontend.

**MongoDB**

* Stores user data: email, password hash, subscription status, usage count, reset tokens.
* Automatically hashes passwords via Mongoose pre-save middleware.
* Enforces a monthly usage limit (e.g., 8 000 tokens) per user.

**Stripe**

* Manages subscriptions and one-time donations.
* Sends webhook events to update user subscription status in MongoDB.
* Supports cancel-at-period-end for user-friendly downgrades.

---

## Data Flow Summary

### Transcription Workflow

1. Chrome extension records or extracts audio.
2. Sends audio + JWT + timestamps → Whisper server `/transcribe`.
3. Whisper server:

   * Checks token validity.
   * Queries GraphQL `getUsageCount`.
   * Converts/slices audio → uploads to Whisper API.
   * Receives transcript → calls GraphQL `incrementUsage`.
   * Returns transcript and estimated token cost to frontend.
4. Extension displays transcript and (optionally) forwards it to ChatGPT.

### Billing & Auth Workflow

1. User registers or logs in via extension → GraphQL API.
2. GraphQL returns a JWT (7-day expiry).
3. User can start or cancel Stripe subscription.
4. Stripe webhook notifies backend → MongoDB updates `subscriptionStatus`.
5. Usage and access are tied to plan status and token quota.

### Password Reset Workflow

1. User requests password reset → GraphQL `requestPasswordReset(email)`.
2. Backend generates a secure token, stores hashed version, emails reset link.
3. User clicks link → submits new password → GraphQL `resetPassword(token, newPassword)`.
4. Password updated and reset token invalidated.

---

## Key Tech

| Layer                | Technology                                   |
| -------------------- | -------------------------------------------- |
| Frontend             | Chrome Extension (Manifest V3), React, Redux |
| Transcription Server | Node.js, Express, FFmpeg, OpenAI Whisper     |
| Backend API          | Apollo GraphQL, MongoDB, Stripe, Nodemailer  |
| Auth                 | JWT                                          |
| Deployment           | Docker, Render                               |
| DevOps               | GitHub Actions, environment-based config     |

---

## Why It’s Unique

* Real-time transcription pipeline bridging browser, backend, and AI.
* Secure, usage-limited, multi-service design with Stripe monetization.
* Demonstrates full-stack engineering, DevOps, and API integration across three domains (frontend extension, AI backend, GraphQL SaaS core).

---

