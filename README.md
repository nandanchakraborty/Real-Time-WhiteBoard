# Real-Time Whiteboard

A collaborative, browser-based whiteboard application built with Node.js, Express, Socket.IO, Prisma, and PostgreSQL. It allows multiple users to draw in real time, add text annotations, manage boards, and share boards with others.

## Features

- Real-time collaborative drawing across connected clients
- Multi-page whiteboard workflow
- Text tool with editable and draggable text boxes
- Board creation, renaming, and recent board history
- Shareable board links for viewing or editing
- Authentication with JWT access and refresh tokens
- Persistent board data stored in PostgreSQL via Prisma

## Tech Stack

- Backend: Node.js, Express
- Realtime sync: Socket.IO
- Database: PostgreSQL + Prisma
- Frontend: vanilla HTML, CSS, and JavaScript
- Auth: JWT

## Project Structure

```text
.
├── public/                  # Browser client assets
│   ├── auth.html
│   ├── auth.js
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── auth.css
├── src/
│   ├── server.js
│   ├── config/
│   ├── controller/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   └── validators/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── .env.example
├── package.json
├── README.md
└── .gitignore
```

## Prerequisites

Before running the project, make sure you have:

- Node.js 18+ installed
- PostgreSQL database running
- npm installed

## Environment Configuration

Create a local environment file based on the example:

```bash
cp .env.example .env
```

Then update the values in `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
PORT=3000
```

Optional:

```env
CLIENT_ORIGIN="http://localhost:3000,http://localhost:5173"
```

This is useful if the frontend is hosted separately from the backend API.

## Installation

Install dependencies:

```bash
npm install
```

Generate the Prisma client:

```bash
npm run db:generate
```

Push the Prisma schema to PostgreSQL:

```bash
npm run db:push
```

## Running the Application

Start the server:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

The app serves:

- the auth page at `/auth`
- the whiteboard UI at `/whiteboard/:boardId`
- the API under `/api`

## Authentication

The app supports JWT-based authentication.

Typical auth routes:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

Use the token in the request header:

```http
Authorization: Bearer <access_token>
```

Refresh tokens can be sent in the JSON body or through the HTTP-only cookie depending on the server flow.

## Board API

Board-related endpoints are available under `/api/boards` and include operations for:

- listing boards
- creating boards
- fetching a board by ID
- sharing board links
- updating board content
- deleting saved boards

## Real-Time Behavior

Socket.IO is used for live synchronization of:

- drawing strokes
- text insertion
- text movement
- text updates
- board rename events
- page and history state changes

## Notes

This project is designed to keep the board state in memory while the server is running, while saving durable board data to PostgreSQL through Prisma. The realtime layer keeps multi-user collaboration responsive without waiting for a database write on every single action.

## License

This project is licensed under the ISC license.

## Author

Nandan chakraborty
nandanchakraborty90@gmail.com
