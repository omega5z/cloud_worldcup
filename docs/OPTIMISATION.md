# Optimisation Docker

Ce document décrit les améliorations apportées au Dockerfile et aux fichiers associés, leur justification, les résultats mesurés, et ce qui reste à faire côté orchestration locale (`docker-compose.yml`).

---

## Contexte

Le Dockerfile initial était volontairement minimal et présentait plusieurs anti-patterns :


| Anti-pattern                   | Problème                                              |
| ------------------------------ | ----------------------------------------------------- |
| `node:latest`                  | Image non reproductible                               |
| `COPY . .` avant `npm install` | Cache Docker inefficace                               |
| `npm install`                  | Lockfile ignoré, dépendances non déterministes        |
| Pas de `--omit=dev`            | Jest, Supertest embarqués dans l'image                |
| Fausse multi-stage             | `AS builder` sans second `FROM`                       |
| Pas de `NODE_ENV=production`   | Comportement runtime non maîtrisé                     |
| Exécution en root              | Surface d'attaque élargie                             |
| Pas de `HEALTHCHECK`           | Pas de signal de santé au niveau image                |
| `.dockerignore` à la racine    | Inefficace car `build: ./app` lit `app/.dockerignore` |
| Port `3000` codé en dur        | Incompatible avec Kubernetes / PaaS                   |


---



## Modifications réalisées



### 1. Multi-stage build réel (`builder` → `production`)

Deux stages distincts :

- `builder` : installe les dépendances de production via `npm ci`
- `production` : image finale minimale, sans outils de build

Le stage `production` ne copie que le strict nécessaire au runtime.

### 2. Image de base figée et légère

- `node:22-alpine` à la place de `node:latest`
- Bénéfice : reproductibilité, image Alpine plus compacte que Debian



### 3. Optimisation du cache Docker

Dans le stage `builder` :

1. `COPY package*.json ./`
2. `RUN npm ci --omit=dev`
3. Le code applicatif n'est copié que dans le stage `production`

Les rebuilds après modification du code ne réinstallent pas les dépendances.

### 4. Dépendances de production uniquement

- `npm ci --omit=dev --no-audit --no-fund`
- `npm cache clean --force` après installation
- Bénéfice : pas de Jest / Supertest / fast-check dans l'image finale



### 5. Copie minimale dans l'image finale

Remplacement de `COPY . .` par une copie sélective :

```dockerfile
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --chown=node:node main.js ./
COPY --chown=node:node public/ ./public/
```

Seuls `main.js`, `public/` et `node_modules` sont présents au runtime.  
`package.json`, `package-lock.json`, `tests/`, `init.sql` et `jest.config.js` sont exclus.

### 6. `app/.dockerignore` au bon emplacement

Fichier créé dans `app/` (contexte de build = `./app` dans `docker-compose.yml`).

Exclusions principales :

```
tests/
init.sql
jest.config.js
*.test.js
node_modules
.env
```



### 7. Sécurité du conteneur

- `ENV NODE_ENV=production`
- `USER node` (utilisateur non-root de l'image officielle Node)
- `COPY --chown=node:node` sur chaque artefact (évite un `RUN chown -R` qui dupliquerait une couche entière et alourdirait l'image)



### 8. Healthcheck image

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1 || exit 1
```

Permet à Docker (et en complément des probes Kubernetes) de détecter un conteneur non réactif.

### 9. Port configurable

Dans `app/main.js` :

```javascript
const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, '0.0.0.0', () => { ... });
```

Le Dockerfile expose `ENV PORT=3000` par défaut. Kubernetes ou un PaaS peut surcharger cette valeur.

---



## Dockerfile final

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /build

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --chown=node:node main.js ./
COPY --chown=node:node public/ ./public/

USER node

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1 || exit 1

CMD ["node", "main.js"]
```

---



## Fichiers modifiés


| Fichier                                   | Changement                                         |
| ----------------------------------------- | -------------------------------------------------- |
| [app/Dockerfile](../app/Dockerfile)       | Multi-stage, copie minimale, sécurité, healthcheck |
| [app/.dockerignore](../app/.dockerignore) | Créé dans `app/` avec exclusions tests/SQL/dev     |
| [app/main.js](../app/main.js)             | `PORT` via `process.env`, bind `0.0.0.0`           |


---



## Taille de l'image (mesurée)

```bash
docker build -t worldcup-app ./app
docker images worldcup-app
```


| Composant                                          | Taille approximative |
| -------------------------------------------------- | -------------------- |
| Base `node:22-alpine`                              | ~163 MB              |
| Dépendances prod (`express`, `pg`, `prom-client`…) | ~13 MB               |
| Code applicatif (`main.js`, `public/`)             | < 1 MB               |
| **Image totale**                                   | **~169 MB**          |


> **Note :** l'objectif indicatif « < 150 MB » de l'issue [#7](https://github.com/omega5z/cloud_worldcup/issues/7) n'est pas atteignable avec l'image officielle `node:22-alpine` seule (~163 MB). La quasi-totalité du poids vient du runtime Node, pas du code applicatif. Pour descendre sous 150 MB, il faudrait une base non standard (image custom, distroless avancé, etc.).

Répartition des dépendances notables dans `node_modules` :

- `prom-client` → `@opentelemetry/api` (~3 MB, dépendance transitive)
- `pg`, `express` et leurs dépendances (~9 MB)

---

## Bénéfices obtenus

- Build reproductible (`npm ci` + version figée)
- Image allégée (~169 MB vs ~198 MB avant optimisation)
- Surface d'attaque réduite (pas de devDependencies, pas de tests/SQL dans l'image)
- Compatibilité Kubernetes (PORT, healthcheck, utilisateur non-root)
- Cache Docker efficace lors des itérations de développement

---



## Vérification

```bash
# Build
docker build -t worldcup-app ./app

# Taille
docker images worldcup-app

# Contenu de l'image (pas de tests ni init.sql)
docker run --rm worldcup-app ls -la /app

# Santé (nécessite PostgreSQL pour les routes métier)
docker compose up --build -d
curl http://localhost:3000/api/health
```

Résultat attendu du health check : `{"status":"ok"}`.

---



## Reste à faire (hors Dockerfile)

Ces points sont suivis via les issues GitHub et concernent `docker-compose.yml`, pas le Dockerfile :


| Issue                                                    | Sujet                                                | État |
| -------------------------------------------------------- | ---------------------------------------------------- | ---- |
| [#1](https://github.com/omega5z/cloud_worldcup/issues/1) | `restart: unless-stopped` sur `app`                  | 🔴   |
| [#2](https://github.com/omega5z/cloud_worldcup/issues/2) | Healthcheck Postgres + `depends_on: service_healthy` | 🔴   |
| [#3](https://github.com/omega5z/cloud_worldcup/issues/3) | Healthcheck Compose sur `app`                        | 🔴   |
| [#4](https://github.com/omega5z/cloud_worldcup/issues/4) | Épingler l'image Postgres (`postgres:15.x-alpine`)   | 🔴   |
| [#5](https://github.com/omega5z/cloud_worldcup/issues/5) | Limites CPU / RAM (FinOps)                           | 🔴   |
| [#6](https://github.com/omega5z/cloud_worldcup/issues/6) | `app/.dockerignore`                                  | 🟢   |
| [#7](https://github.com/omega5z/cloud_worldcup/issues/7) | Dockerfile production-ready                          | 🟢   |
| [#8](https://github.com/omega5z/cloud_worldcup/issues/8) | Variable `PORT`                                      | 🟢   |


---



## Conclusion

Le Dockerfile est désormais conforme aux bonnes pratiques de conteneurisation pour une application Node.js en production : multi-stage réel, dépendances figées, copie minimale, utilisateur non-root, healthcheck et port configurable.

La prochaine étape naturelle est de durcir `docker-compose.yml` (healthchecks, restart, limites ressources) pour aligner le comportement local sur ce qu'attend un déploiement Kubernetes.