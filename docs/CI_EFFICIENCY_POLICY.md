# GitHub CI / Agent Efficiency Policy

Cette politique est canonique pour tout workflow GitHub Actions, factory, finalizer, agent autonome ou boucle de réparation du dépôt ChoreScore.

## Principe

**Minimiser le coût total avant de maximiser la couverture.**

Toute exécution doit optimiser simultanément :
- temps mur ;
- minutes GitHub Actions / compute ;
- appels et tokens LLM ;
- builds, exports, installs et téléchargements répétés ;
- probabilité de découvrir plusieurs erreurs dans une seule passe.

Une vérification plus lourde n'est autorisée que si une vérification moins chère ne peut pas fournir la preuve nécessaire.

## Ordre obligatoire

Pour chaque changement ou échec :

1. **Classifier d'abord** : produit, test/harness, CI/runner, build/native, réseau/provider, configuration.
2. **Déterministe avant LLM** : logs, diff, scripts, validateurs, tests ciblés et métadonnées avant tout agent.
3. **Réutiliser avant reconstruire** : artifact, APK, cache, export, dépendances et résultats déjà prouvés pour le même SHA.
4. **Tester le delta avant le monde entier** : test ciblé / syntaxe / typecheck concerné d'abord.
5. **Fail fast, collect wide** : dans une même couche peu coûteuse, collecter autant d'erreurs que possible ; ne pas lancer la couche coûteuse si la couche précédente échoue.
6. **Full gates une seule fois** : la validation exhaustive appartient au handoff/release ou à un changement produit qui le justifie, pas à chaque correction de harness.
7. **Build natif le plus tard possible** : pas de Gradle/iOS/export lourd si le delta ne touche ni produit/native/dependencies et si un binaire valide est réutilisable.
8. **LLM minimal** : zéro agent quand un script déterministe suffit ; un modèle par défaut ; fallback seulement après échec prouvé. Pas de panel de modèles systématique.
9. **Pas de revalidation identique** : une gate verte pour un SHA/input identique est mémorisable/réutilisable. Toute répétition doit avoir une raison explicite.
10. **Retries bornés et intelligents** : un retry identique n'est permis que pour une panne transitoire prouvée ; après le seuil, changer de stratégie ou escalader.
11. **Une seule source de déclenchement** : éviter les tempêtes push/schedule/self-dispatch. Un état ne doit avoir qu'un propriétaire actif.
12. **Concurrence utile** : paralléliser les checks indépendants et bon marché ; sérialiser uniquement les mutations de branche/artifact.
13. **Artifact-first debugging** : sur échec tardif, conserver les binaires et diagnostics nécessaires pour reprendre au point de panne.
14. **Ne jamais payer deux fois la même preuve** : si le finalizer va refaire immédiatement une gate exhaustive, la repair lane ne refait que les checks nécessaires à la sécurité de son delta.

## Budget LLM obligatoire

- Aucun LLM pour : retry infra pur, validation de schéma, hash, artifact routing, cache decision, classification par signatures connues.
- Une réparation harness/CI : un modèle, un essai court ; second modèle uniquement si le premier ne produit aucun delta exploitable.
- Une réparation produit : un Builder. L'Auditor n'est appelé qu'après un delta ou une preuve nouvelle.
- Les probes multi-modèles ne sont pas un prérequis normal. Ils sont un fallback de disponibilité, pas une étape de routine.
- Aucun Director LLM si l'état suivant est déterminable de façon sûre par un script.

## Budget build obligatoire

Un workflow doit calculer la classe du delta avant les étapes lourdes :
- docs/control only → aucun build produit ;
- harness only → syntaxe/tests harness + réutilisation artifact ;
- JS/product non-native → tests/typecheck + export pertinent ; pas de Gradle systématique ;
- native/dependency/config → prebuild/build natif ciblé ;
- release → full gates + golden path + artifact final.

## Échecs tardifs

Un échec tardif ne remet jamais implicitement à zéro les preuves antérieures. Le workflow reprend au point le plus proche possible :
- infra → retry direct borné ;
- harness → réparer harness et réutiliser le même binaire ;
- produit → réparer le produit puis invalider uniquement les preuves dépendantes du delta ;
- artifact/handoff → reprendre le handoff sans rebuilder le produit.

## Observabilité

Chaque étape lourde doit être justifiable dans les logs par :
- la classe du delta/échec ;
- pourquoi cette étape est nécessaire ;
- quelle preuve antérieure ne peut pas être réutilisée.

Si cette justification n'existe pas, l'étape lourde est présumée inutile et doit être supprimée ou déplacée.

## Règle de conception

Lorsqu'un workflow est modifié, l'auteur doit se demander explicitement :

> « Si cette étape échoue dix fois de suite, combien de travail identique allons-nous répéter ? »

Si la réponse est « beaucoup », le workflow est mal découpé : ajouter checkpoint, artifact, cache, fast lane ou classification avant merge.
