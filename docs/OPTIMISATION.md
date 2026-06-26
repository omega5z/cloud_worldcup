# Optimisation du `docker-compose.yml`

Ce document décrit les améliorations apportées à l'orchestration locale et la justification de chaque choix.

---

## 1. Externalisation des secrets via `.env`

### Avant

Les identifiants PostgreSQL étaient codés en dur dans `docker-compose.yml` :

```yaml
environment:
  - DB_PASSWORD=postgres
  - POSTGRES_PASSWORD=postgres
```

### Après

- **`.env.dist`** — modèle versionné dans Git, sans secret de production. Les étudiants le copient pour démarrer.
- **`.env`** — fichier local chargé automatiquement par Docker Compose, ignoré par Git (`.gitignore`).

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

1. **Sécurité** — Les mots de passe ne sont plus commités dans le dépôt. En production, les mêmes variables seront fournies par un gestionnaire de secrets (AWS Secrets Manager, Kubernetes Secrets, etc.) sans changer la structure du compose.
2. **Source unique de vérité** — `POSTGRES_PASSWORD` n'est défini qu'une fois dans `.env`. L'app et PostgreSQL utilisent la même valeur, ce qui évite les désynchronisations.
3. **Reproductibilité** — `.env.dist` documente les variables attendues. Un nouvel arrivant sait exactement quoi configurer.
4. **Préparation au cloud** — Le pattern « config dans l'environnement, pas dans le code » est la base de l'industrialisation demandée dans le capstone.

---

## Améliorations envisageables (non encore appliquées)

Les points suivants ont été identifiés lors de l'audit initial et pourront être traités dans une prochaine itération :

| Amélioration | Bénéfice |
|--------------|----------|
| `restart: unless-stopped` sur `app` | Self-healing après `/api/admin/kill` |
| Healthcheck PostgreSQL + `depends_on: condition: service_healthy` | Démarrage fiable au premier boot |
| Healthcheck sur `app` (`/api/health`) | Alignement avec les probes Kubernetes |
| Suppression de `version: "3.8"` | Supprime l'avertissement Compose v2 (clé obsolète) |
| Tag Postgres épinglé (`postgres:15.x-alpine`) | Builds reproductibles |
| Limites CPU/RAM | Réflexion FinOps et dimensionnement |
| Port bindé sur `127.0.0.1:3000` | Réduction de la surface d'exposition en local |
