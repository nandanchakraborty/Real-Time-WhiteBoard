# Real-Time Whiteboard

Collaborative drawing board with an Express/REST API, Socket.IO realtime transport, and a browser client.

The browser client can be hosted separately from the API by defining `window.WHITEBOARD_API_URL` before loading `auth.js` or `script.js`. The API exposes authentication and board resources under `/api`, while Socket.IO handles live drawing events.

## Structure

```text
src/       server source
public/    browser files
package.json
README.md
```

## Run

```bash
npm start
```

Open `http://localhost:3000` in a browser.

## API client configuration

Set `CLIENT_ORIGIN` to the comma-separated origin(s) of a separately hosted client:

```bash
CLIENT_ORIGIN=http://localhost:5173 npm start
```

Useful endpoints include `GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, and the board endpoints under `/api/boards`. Send access tokens as `Authorization: Bearer <token>`. Refresh tokens may be sent in the `refreshToken` JSON field or through the HTTP-only cookie.

## PostgreSQL

Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL connection string.
Then generate the Prisma client:

```bash
npm run db:generate
```

Use `npm run db:push` after adding Prisma models to sync them to the database.
