# Optimisation du Dockerfile

Ce document est la documentation unique de l’optimisation Docker du projet. Il regroupe les changements réalisés, leur justification, et les bénéfices attendus.

---

## Contexte

Le Dockerfile initial était très basique et présentait plusieurs anti-patterns :

- image de base non figée avec `node:latest`
- copie de tout le contexte avant l’installation des dépendances
- utilisation de `npm install` au lieu de `npm ci`
- absence de `NODE_ENV=production`
- absence de `HEALTHCHECK`
- exécution en tant que root

---

## Modifications réalisées

### 1. Version d’image figée

- remplacement de `node:latest` par `node:22-alpine`
- bénéfice : stabilité, reproductibilité et image plus légère

### 2. Optimisation du cache Docker

- copie préalable de `package.json` et `package-lock.json`
- installation des dépendances ensuite
- copie du reste du projet seulement après cette étape
- bénéfice : meilleure réutilisation du cache Docker lors des builds successifs

### 3. Installation de dépendances de production uniquement

- utilisation de `npm ci --omit=dev`
- bénéfice : image plus légère et surface d’attaque réduite

### 4. Sécurité du conteneur

- définition de `NODE_ENV=production`
- exécution avec `USER node`
- bénéfice : moins de privilèges dans le conteneur et comportement plus conforme à un usage de production

### 5. Healthcheck

- ajout d’un `HEALTHCHECK` vers `/api/health`
- bénéfice : le moteur Docker et Kubernetes peuvent détecter un conteneur défaillant et réagir automatiquement

### 6. Port configurable

- le serveur Node.js écoute désormais sur `process.env.PORT` avec fallback sur `3000`
- bénéfice : meilleure compatibilité avec les environnements conteneurisés et orchestrés

### 7. Multi-stage build

- un stage `builder` a été introduit pour préparer une structure plus propre en vue d’évolutions futures
- nuance importante : dans l’état actuel du projet, le bénéfice réel est limité, car l’application ne compile pas de binaire ou d’artefact spécifique à l’étape de build

---

## Fichiers modifiés

- [app/Dockerfile](../app/Dockerfile)
- [app/main.js](../app/main.js)
- [app/.dockerignore](../app/.dockerignore)

---

## Bénéfices obtenus

- build reproductible
- image plus légère
- surface d’attaque réduite
- compatibilité Kubernetes
- déploiement plus fiable
- meilleure résilience

---

## Vérification effectuée

Le build Docker a été vérifié avec la commande suivante :

```bash
docker build -t worldcup-app-test .
```

Résultat vérifié : le build s’est exécuté avec succès.

---

## Conclusion

Cette version du Dockerfile est conforme aux bonnes pratiques attendues pour une application Node.js conteneurisée, avec un bon niveau de qualité pour une première étape de modernisation cloud-native.
