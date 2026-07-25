# Build this Dockerfile from the repository root so the migration target can
# include the historical SQL snapshot in ../drizzle without a second copy.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

FROM base AS runtime

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir . && useradd --create-home --uid 10001 postpilot
USER 10001

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

# Schema application is a separate, non-root job image. It shares exactly the
# same application/config code as the API but includes Alembic's revision tree.
FROM base AS migrations

COPY backend/pyproject.toml backend/alembic.ini ./
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY drizzle ./drizzle
RUN pip install --no-cache-dir . && useradd --create-home --uid 10001 postpilot
USER 10001
CMD ["alembic", "upgrade", "head"]

# Demo fixtures are an opt-in operations job. They run with the same Python
# application contract as migrations and never ship in the frontend image.
FROM base AS seed

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir . && useradd --create-home --uid 10001 postpilot
USER 10001
CMD ["python", "-m", "app.demo_seed"]
