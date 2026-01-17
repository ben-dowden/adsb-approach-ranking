.PHONY: install lint typecheck test dev build clean pipeline

# Development
install:
	pnpm install

lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

format:
	pnpm format

typecheck:
	pnpm typecheck

test:
	pnpm test

test-watch:
	pnpm test:watch

# Dashboard
dev:
	pnpm dashboard:dev

build:
	pnpm dashboard:build

# Pipeline
pipeline-ingest:
	pnpm pipeline:ingest

pipeline-derive:
	pnpm pipeline:derive

pipeline-score:
	pnpm pipeline:score

pipeline: pipeline-ingest pipeline-derive pipeline-score

# Cleanup
clean:
	rm -rf node_modules
	rm -rf packages/*/node_modules
	rm -rf apps/*/node_modules
	rm -rf packages/*/dist
	rm -rf apps/*/.next
