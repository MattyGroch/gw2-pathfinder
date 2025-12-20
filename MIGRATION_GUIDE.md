# Migration to PostgreSQL Backend

This guide explains the migration from client-side localStorage caching to a PostgreSQL-backed backend server.

## What Changed

### Before
- All achievement data was fetched directly from GW2 API
- Data was cached in browser localStorage
- Cache expired after 24 hours
- Each user fetched data independently

### After
- Achievement data is stored in PostgreSQL database
- Backend server provides REST API endpoints
- Data is synced nightly from GW2 API (2 AM UTC)
- All users share the same cached database
- Faster load times (no API rate limiting per user)

## Architecture

```
Frontend (React) → Backend API (Express) → PostgreSQL Database
                                      ↓
                              GW2 API (nightly sync)
```

## Setup Instructions

### 1. Database Setup

Create a PostgreSQL database:
```sql
CREATE DATABASE gw2_pathfinder;
```

### 2. Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL
npm run migrate  # Creates tables
npm run dev      # Start server
```

### 3. Frontend Setup

```bash
# In project root
npm install
# Create .env file (optional, defaults to localhost:3001)
echo "VITE_API_BASE=http://localhost:3001/api" > .env
npm run dev
```

## API Endpoints

The backend provides these endpoints:

- `GET /api/groups` - All achievement groups
- `GET /api/groups/:groupId/categories` - Categories for a group
- `GET /api/categories/:categoryId/achievements` - Achievements for a category
- `GET /api/achievements?ids=1,2,3` - Specific achievements
- `GET /api/achievement-category-map` - Achievement to category mapping
- `POST /api/sync` - Manual sync trigger
- `GET /health` - Health check

## Data Sync

- **Initial Sync**: Runs automatically on first server startup if database is empty
- **Nightly Sync**: Cron job runs at 2:00 AM UTC daily
- **Manual Sync**: POST to `/api/sync` endpoint

## Deployment Considerations

1. **Environment Variables**:
   - Backend: `DATABASE_URL`, `PORT`, `NODE_ENV`
   - Frontend: `VITE_API_BASE` (points to your deployed backend URL)

2. **Database**: Ensure PostgreSQL is accessible and has proper backups

3. **Cron Jobs**: The nightly sync uses `node-cron`. For production, consider:
   - Using system cron instead
   - Adding monitoring/alerting for sync failures
   - Logging sync results

4. **Performance**: 
   - Consider adding Redis cache layer for frequently accessed data
   - Add database connection pooling (already configured in `pg.Pool`)
   - Monitor query performance and add indexes as needed

## What's Still Client-Side

- User API key (stored in localStorage)
- User progress (fetched from GW2 API, not stored in DB)
- Starred achievements (stored in localStorage)

These remain client-side for privacy and because they're user-specific data.

