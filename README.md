# GW2 Pathfinder

A Guild Wars 2 achievement tracking application with PostgreSQL backend.

## Architecture

This application consists of:
- **Frontend**: React + TypeScript + Vite (client-side application)
- **Backend**: Node.js + Express + PostgreSQL (server-side API and data storage)

## Quick Start

### Option 1: Docker (Recommended)

The easiest way to run the full stack:

```bash
# Copy environment template
cp env.docker.example .env

# Start all services (database, backend, frontend)
docker-compose up -d

# View logs
docker-compose logs -f

# Access the app at http://localhost
```

See [DOCKER.md](./DOCKER.md) for detailed Docker documentation.

### Option 2: Local Development

#### Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- npm or yarn

#### Setup

1. **Clone and install frontend dependencies:**
   ```bash
   npm install
   ```

2. **Set up the backend:**
   ```bash
   cd server
   npm install
   cp .env.example .env
   # Edit .env with your PostgreSQL connection string
   npm run migrate
   ```

3. **Start the backend server:**
   ```bash
   cd server
   npm run dev  # Development mode with auto-reload
   ```

4. **Start the frontend (in a new terminal):**
   ```bash
   npm run dev
   ```

5. **Configure frontend API URL (optional):**
   - Create a `.env` file in the root directory
   - Add: `VITE_API_BASE=http://localhost:3001/api`
   - Or it will default to `http://localhost:3001/api`

## Features

- Achievement tracking with progress bars
- Starred achievements for personal path
- Dashboard with recommendations
- PostgreSQL-backed data storage
- Automatic nightly sync with GW2 API
- User progress tracking via GW2 API key

## Documentation

- [Docker Deployment Guide](./DOCKER.md) - Complete Docker setup and deployment
- [Migration Guide](./MIGRATION_GUIDE.md) - Details on the PostgreSQL migration
- [Server README](./server/README.md) - Backend-specific documentation

## Development

### Using Make (if available)

```bash
make up      # Start all services
make logs    # View logs
make down    # Stop services
make sync    # Trigger data sync
```

### Using Docker Compose directly

See [DOCKER.md](./DOCKER.md) for all available commands.

## Project Structure

```
gw2-pathfinder/
├── src/              # Frontend React application
├── server/           # Backend Express API
│   ├── src/
│   │   ├── db/       # Database schema and migrations
│   │   ├── routes/   # API routes
│   │   └── services/ # Business logic and sync service
├── docker-compose.yml # Docker orchestration
├── Dockerfile        # Frontend production image
└── server/Dockerfile # Backend production image
```
