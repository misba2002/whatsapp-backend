# WhatsApp Clone

This is a full-stack WhatsApp clone application with React frontend and Node.js/Express backend.

## Live Demo

- Frontend: [https://whatapp-frontend.onrender.com/](https://whatapp-frontend.onrender.com/)
- Backend: [https://whatsapp-backend-l8tf.onrender.com/](https://whatsapp-backend-l8tf.onrender.com/)

## Features

- Real-time chat using Socket.IO
- Chat list and message window
- Message status updates
- Responsive UI built with React

## Tech Stack

- Frontend: React, Socket.IO-client, Tailwind CSS (or your styling)
- Backend: Node.js, Express, Socket.IO, MongoDB (assumed)

## Deployment

- Frontend deployed on Render as a Static Site
- Backend deployed on Render as a Web Service

## Usage

1. Open the frontend URL in your browser.
2. The frontend connects to the backend API and Socket.IO server.
3. Start chatting!

## Environment Variables

- The frontend uses the backend URL (hardcoded or via environment variable).
- The backend uses MongoDB connection string and other config variables.

---

## Running Locally

### Prerequisites

- Node.js and npm installed
- MongoDB instance running or MongoDB Atlas URI

### Frontend

```bash
cd frontend
npm install
npm run dev

### Backend

cd backend
npm install
# Set your environment variables (e.g., MONGODB_URI) in a .env file
npm start
The backend runs on http://localhost:5000 (or your configured port).

Environment Variables
Frontend uses VITE_BACKEND_URL (optional if hardcoded)

Backend requires MongoDB connection string and other config in .env

