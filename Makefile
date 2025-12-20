# Makefile for common Docker operations

.PHONY: help up down build logs clean restart migrate sync

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

up: ## Start all services
	docker-compose up -d

down: ## Stop all services
	docker-compose down

build: ## Build all Docker images
	docker-compose build

logs: ## View logs from all services
	docker-compose logs -f

logs-backend: ## View backend logs only
	docker-compose logs -f backend

logs-frontend: ## View frontend logs only
	docker-compose logs -f frontend

logs-db: ## View database logs only
	docker-compose logs -f postgres

clean: ## Stop services and remove volumes (WARNING: deletes database)
	docker-compose down -v

restart: ## Restart all services
	docker-compose restart

restart-backend: ## Restart backend only
	docker-compose restart backend

restart-frontend: ## Restart frontend only
	docker-compose restart frontend

migrate: ## Run database migrations manually
	docker-compose exec backend npm run migrate

sync: ## Trigger manual data sync
	curl -X POST http://localhost:3001/api/sync

psql: ## Access PostgreSQL shell
	docker-compose exec postgres psql -U gw2user -d gw2_pathfinder

backup: ## Backup database
	docker-compose exec postgres pg_dump -U gw2user gw2_pathfinder > backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "Backup saved to backup_*.sql"

dev: ## Start in development mode with hot-reload
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

