# Optimisations Docker & orchestration locale

Ce document décrit les améliorations apportées au dépôt, leur justification, et ce qui reste à faire.

---

## 1. Dockerfile — premières optimisations

### Avant

```dockerfile
FROM node:latest

WORKDIR /app

COPY . .

RUN npm install

EXPOSE 3000

CMD ["node", "main.js"]
```

### Après

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

USER node

EXPOSE 3000

CMD ["node", "main.js"]
```

### Ce qui a été amélioré

| Changement | Bénéfice |
|------------|----------|
| `node:latest` → `node:20-alpine` | Image de base légère et version épinglée (reproductibilité) |
| `COPY package*.json` avant `npm install` | Cache Docker : les deps ne sont re-buildées que si `package.json` change |
| `COPY . .` après l'installation | Meilleur ordre des layers |
| `USER node` | L'application ne tourne plus en root |

### Ce qui reste à faire (issues [#6](https://github.com/omega5z/cloud_worldcup/issues/6), [#7](https://github.com/omega5z/cloud_worldcup/issues/7))

| Anti-pattern restant | Impact |
|----------------------|--------|
| Fausse multi-stage (`AS builder` sans 2e `FROM`) | Image finale non allégée |
| `npm install` sans `--omit=dev` | Jest et outils de test dans l'image (~198 MB) |
| `npm install` au lieu de `npm ci` | Builds moins reproductibles |
| Pas de `NODE_ENV=production` | Comportement runtime non aligné prod |
| Pas de `HEALTHCHECK` dans l'image | Pas de signal de santé au niveau conteneur |
| `USER node` après install root | `node_modules` appartient à root (uid 0) |

---

## 2. `.dockerignore` — ajout initial (commit `219fd64`)

### Ce qui a été fait

Un fichier `.dockerignore` a été ajouté à la racine du dépôt pour exclure notamment :

- `node_modules`, `coverage`, `docs`, `.env*`
- `jest.config.js`, fichiers IDE, logs

### Limitation connue 🟡

`docker-compose.yml` utilise `build: ./app`. Docker ne lit que **`app/.dockerignore`**, pas celui à la racine.

**Conséquence :** `tests/`, `init.sql`, `jest.config.js` et le `Dockerfile` sont encore présents dans l'image au build actuel.

**Action restante :** déplacer ou dupliquer le fichier vers `app/.dockerignore` — voir issue [#6](https://github.com/omega5z/cloud_worldcup/issues/6).

---

## 3. Externalisation des secrets via `.env` (commit `f4bbd51`)

### Avant

Les identifiants PostgreSQL étaient codés en dur dans `docker-compose.yml` :

```yaml
environment:
  - DB_PASSWORD=postgres
  - POSTGRES_PASSWORD=postgres
```

### Après

- **`.env.dist`** — modèle versionné dans Git, sans secret de production.
- **`.env`** — fichier local chargé automatiquement par Docker Compose, ignoré par Git.

```bash
cp .env.dist .env
docker compose up --build
```

Les variables sont injectées dans les deux services :

| Variable | Service `app` | Service `db` |
|----------|---------------|--------------|
| `POSTGRES_USER` | `DB_USER` | `POSTGRES_USER` |
| `POSTGRES_PASSWORD` | `DB_PASSWORD` | `POSTGRES_PASSWORD` |
| `POSTGRES_DB` | `DB_NAME` | `POSTGRES_DB` |
| `DB_HOST` | `DB_HOST` | — |
| `DB_PORT` | `DB_PORT` | — |

### Pourquoi

1. **Sécurité** — Les mots de passe ne sont plus commités dans le dépôt.
2. **Source unique de vérité** — `POSTGRES_PASSWORD` défini une seule fois dans `.env`.
3. **Reproductibilité** — `.env.dist` documente les variables attendues.
4. **Préparation au cloud** — Même pattern migrable vers des `Secret` Kubernetes.

---

## 4. Améliorations restantes

### docker-compose.yml

| Amélioration | Bénéfice | Issue |
|--------------|----------|-------|
| `restart: unless-stopped` sur `app` | Self-healing après `/api/admin/kill` | [#1](https://github.com/omega5z/cloud_worldcup/issues/1) |
| Healthcheck PostgreSQL + `service_healthy` | Démarrage fiable au premier boot | [#2](https://github.com/omega5z/cloud_worldcup/issues/2) |
| Healthcheck sur `app` (`/api/health`) | Alignement probes Kubernetes | [#3](https://github.com/omega5z/cloud_worldcup/issues/3) |
| Tag Postgres épinglé (`postgres:15.x-alpine`) | Builds reproductibles | [#4](https://github.com/omega5z/cloud_worldcup/issues/4) |
| Limites CPU/RAM | Réflexion FinOps et dimensionnement | [#5](https://github.com/omega5z/cloud_worldcup/issues/5) |
| Suppression de `version: "3.8"` | Supprime l'avertissement Compose v2 | — |
| Port bindé sur `127.0.0.1:3000` | Réduction surface d'exposition en local | — |

### Dockerfile & application

| Amélioration | Issue |
|--------------|-------|
| `app/.dockerignore` effectif | [#6](https://github.com/omega5z/cloud_worldcup/issues/6) |
| Dockerfile multi-stage production (`npm ci --omit=dev`, `HEALTHCHECK`) | [#7](https://github.com/omega5z/cloud_worldcup/issues/7) |
| Variable d'environnement `PORT` | [#8](https://github.com/omega5z/cloud_worldcup/issues/8) |

---

## Synthèse

| Zone | Statut |
|------|:------:|
| Dockerfile — base alpine, cache layers, `USER node` | 🟡 Partiel |
| `.dockerignore` | 🟡 Présent mais non appliqué au build |
| Secrets via `.env` / `.env.dist` | 🟢 Fait |
| docker-compose — résilience & healthchecks | 🔴 À faire |
| Dockerfile — multi-stage production | 🔴 À faire |
