# Docker Deployment Guide

This guide explains how to run GW2 Pathfinder using Docker and Docker Compose.

## Quick Start

1. **Create environment file:**
   ```bash
   cp env.docker.example .env
   # Edit .env with your desired configuration
   ```

2. **Start all services:**
   ```bash
   docker-compose up -d
   ```

3. **View logs:**
   ```bash
   docker-compose logs -f
   ```

4. **Access the application:**
   - Frontend: http://localhost (or port specified in `.env`)
   - Backend API: http://localhost:3001/api
   - Database: localhost:5432

## Services

The Docker Compose setup includes:

- **postgres**: PostgreSQL 16 database
- **backend**: Node.js Express API server
- **frontend**: React frontend served via Nginx

## Production Deployment

### Build and Run

```bash
# Build all images
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove volumes (WARNING: deletes database)
docker-compose down -v
```

### Environment Variables

Key environment variables (set in `.env`):

- `POSTGRES_USER`: Database username (default: `gw2user`)
- `POSTGRES_PASSWORD`: Database password (default: `gw2pass`)
- `POSTGRES_DB`: Database name (default: `gw2_pathfinder`)
- `VITE_API_BASE`: Backend API URL for frontend (default: `http://localhost:3001/api`)

**Important**: In production, change `VITE_API_BASE` to your actual backend URL. The frontend is built with this value at build time.

### Data Persistence

Database data is stored in a Docker volume (`postgres_data`). To backup:

```bash
# Backup
docker-compose exec postgres pg_dump -U gw2user gw2_pathfinder > backup.sql

# Restore
docker-compose exec -T postgres psql -U gw2user gw2_pathfinder < backup.sql
```

## Development Mode

For development with hot-reload:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts source code as volumes for live reloading.

## Manual Operations

### Run Database Migrations

Migrations run automatically on backend startup. To run manually:

```bash
docker-compose exec backend npm run migrate
```

### Trigger Data Sync

```bash
curl -X POST http://localhost:3001/api/sync
```

### Access Database

```bash
docker-compose exec postgres psql -U gw2user -d gw2_pathfinder
```

### View Backend Logs

```bash
docker-compose logs -f backend
```

### Rebuild After Code Changes

```bash
# Rebuild specific service
docker-compose build backend
docker-compose up -d backend

# Rebuild all
docker-compose build
docker-compose up -d
```

## Health Checks

All services include health checks:

- **Backend**: `GET /health` endpoint
- **Frontend**: Nginx health check
- **PostgreSQL**: `pg_isready` check

Check service health:

```bash
docker-compose ps
```

## Troubleshooting

### Database Connection Issues

If the backend can't connect to the database:

1. Check if PostgreSQL is healthy:
   ```bash
   docker-compose ps postgres
   ```

2. Check backend logs:
   ```bash
   docker-compose logs backend
   ```

3. Verify DATABASE_URL in backend environment:
   ```bash
   docker-compose exec backend env | grep DATABASE_URL
   ```

### Frontend Can't Reach Backend

1. Ensure `VITE_API_BASE` is set correctly in `.env`
2. Rebuild frontend after changing `VITE_API_BASE`:
   ```bash
   docker-compose build frontend
   docker-compose up -d frontend
   ```

### Port Conflicts

If ports are already in use, change them in `.env`:

```env
POSTGRES_PORT=5433
BACKEND_PORT=3002
FRONTEND_PORT=8080
```

## Production Considerations

1. **Security**:
   - Change default database credentials
   - Use strong passwords
   - Consider using Docker secrets for sensitive data
   - Set up SSL/TLS for production

2. **Performance**:
   - Adjust PostgreSQL shared_buffers and other settings
   - Consider adding Redis for caching
   - Use a reverse proxy (nginx/traefik) in front

3. **Monitoring**:
   - Set up log aggregation
   - Monitor database size and performance
   - Set up alerts for sync failures

4. **Backups**:
   - Schedule regular database backups
   - Store backups off-container
   - Test restore procedures

5. **Scaling**:
   - Frontend can be scaled horizontally (stateless)
   - Backend can be scaled with load balancer
   - Database should remain single instance (or use read replicas)

## Docker Compose Override

You can create `docker-compose.override.yml` for local customizations (this file is automatically loaded):

```yaml
version: '3.8'
services:
  backend:
    environment:
      NODE_ENV: development
```

This file is gitignored and won't be committed.

