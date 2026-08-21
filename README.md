# Real-Time Whiteboard

Collaborative drawing board built with Express, Socket.IO, HTML, CSS, and JavaScript.

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

## PostgreSQL

Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL connection string.
Then generate the Prisma client:

```bash
npm run db:generate
```

Use `npm run db:push` after adding Prisma models to sync them to the database.
