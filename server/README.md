# GW2 Pathfinder Backend Server

This is the backend server for GW2 Pathfinder, providing a PostgreSQL-backed API for achievement data.

## Setup

1. **Install dependencies:**
   ```bash
   cd server
   npm install
   ```

2. **Set up PostgreSQL database:**
   - Create a PostgreSQL database (e.g., `gw2_pathfinder`)
   - Copy `.env.example` to `.env` and update with your database connection string:
     ```
     DATABASE_URL=postgresql://user:password@localhost:5432/gw2_pathfinder
     PORT=3001
     NODE_ENV=development
     ```

3. **Run database migrations:**
   ```bash
   npm run migrate
   ```

4. **Start the server:**
   ```bash
   # Development (with auto-reload)
   npm run dev
   
   # Production
   npm run build
   npm start
   ```

## Features

- **Automatic Data Sync**: On first startup, the server will automatically sync all achievement data from the GW2 API
- **Nightly Sync**: A cron job runs at 2:00 AM UTC daily to keep data up to date
- **Manual Sync**: Trigger a sync manually via `POST /api/sync`

## API Endpoints

- `GET /api/groups` - Get all achievement groups
- `GET /api/groups/:groupId/categories` - Get categories for a group
- `GET /api/categories/:categoryId/achievements` - Get achievements for a category
- `GET /api/achievements?ids=1,2,3` - Get specific achievements by IDs
- `GET /api/achievement-category-map` - Get mapping of achievement IDs to category IDs
- `POST /api/sync` - Manually trigger data synchronization
- `GET /health` - Health check endpoint

## Database Schema

The database stores:
- Achievement groups
- Achievement categories
- Achievements with full details
- Relationships between groups, categories, and achievements

See `src/db/schema.sql` for the full schema.

