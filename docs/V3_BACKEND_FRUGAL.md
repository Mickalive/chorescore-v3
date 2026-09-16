# ChoreScore V3 — backend frugal, zero-waste sync & data pipeline

Ce document est **canonique et additif** à `docs/V3_CONSTITUTION.md`. En cas de tension, préserver d'abord l'intégrité comptable, la sécurité, l'isolation des groupes et la confidentialité, puis choisir l'option la plus frugale en lectures, écritures, réseau, fonctions, stockage et IA.

## 1. Principe économique

ChoreScore doit pouvoir servir ses premiers milliers puis dizaines de milliers d'utilisateurs avec un coût d'infrastructure aussi proche de zéro que raisonnablement possible. Toute architecture doit minimiser lectures distantes, écritures inutiles, listeners temps réel, transfert réseau, serverless, stockage dupliqué, scans complets, recalculs et appels IA.

Philosophie : **Write once. Sync deltas. Read local. Derive incrementally. Classify once. Aggregate later.**

Interdits : scale-up theatre, scans complets par défaut, IA par ligne, réseau à chaque render/changement d'onglet, copies de données sans raison, coût avant la valeur.

## 2. Local-first réel

Le réseau synchronise l'état ; il ne sert pas de disque distant interrogé à chaque interaction. Les données métier nombreuses doivent vivre dans une base locale indexée, préférentiellement `expo-sqlite`, plutôt que dans de gros tableaux JSON AsyncStorage.

AsyncStorage reste acceptable pour petites préférences, flags, configuration légère et éventuellement curseurs de sync.

Doivent être indexables localement : `ContributionEntry`, `ExpenseEntry`, `CrossLedgerSettlement`, `TodoItem`, `PersistentTask`, membres, rollups dérivés et métadonnées de sync. Prévoir selon besoin des indexes sur `groupId`, `occurredAt`, `updatedAt`, type, membre, statut et `persistentTaskId`.

L'UI lit d'abord le local. Ouvrir la racine, un groupe, Ajouter, Balances, À faire ou changer d'onglet ne doit normalement déclencher aucune lecture réseau obligatoire. La synchronisation peut se faire en arrière-plan.

## 3. Sync delta-only

Ne jamais télécharger une collection entière pour filtrer ou recalculer côté client. Chaque objet synchronisable doit avoir au minimum : `id`, `groupId`, `createdAt`, `updatedAt`, `revision/version` et tombstone/état de suppression lorsque nécessaire.

Chaque client conserve un curseur par groupe. Si le client est à la révision 1842 et le groupe à 1846, récupérer uniquement 1843..1846. Le mécanisme concret peut varier selon l'adapter, mais le principe delta-only est obligatoire.

Si du temps réel est utile, préférer un seul signal léger du type `groups/{groupId}/syncState` contenant la révision courante. À changement : comparer le curseur local, récupérer les deltas, les appliquer transactionnellement puis avancer le curseur. Une alternative foreground sync + refresh explicite + notifications est acceptable si elle est plus simple et moins coûteuse.

Pas de listeners permanents sur l'historique complet, toutes les tâches, toutes les dépenses ou plusieurs collections en parallèle sans justification mesurée.

## 4. Pas de N+1, pas de full scan

Interdit : charger 20 groupes puis faire 20 requêtes membres, 20 balances, 20 settings. La racine doit disposer localement ou via une représentation compacte des données nécessaires.

Ajouter instrumentation/tests pour détecter les appels repository répétés. Une action courante ne doit jamais avoir un coût proportionnel à l'historique total.

## 5. Balances matérialisées et ledger append-oriented

Les écritures de ledger restent la source comptable primaire et auditable. L'affichage courant utilise des vues matérialisées reconstruisibles : balance contribution par membre/unité, total contribution si utile, balance argent par membre/devise, total payé si utile.

Une nouvelle opération applique un delta à ces vues ; on ne rejoue pas `SUM(allEntriesSinceCreation)` à chaque écran. Des tests/outils doivent vérifier périodiquement `materialized balance == balance reconstruite depuis le ledger`.

Création, modification, suppression et compensation doivent laisser une trace. Préférer révision, inversion et/ou tombstone lorsque nécessaire pour audit, résolution de conflit et reconstruction. Ne jamais supprimer silencieusement une opération distante au point de perdre l'auditabilité.

## 6. Historique paginé et cache local

Ne jamais télécharger des années d'historique à l'ouverture. Afficher d'abord les éléments récents locaux. Récupérer l'ancien par pagination/cursor raisonnable et le mettre en cache. Une page immuable déjà présente ne doit pas être re-téléchargée sans besoin de reconciliation/version.

## 7. Writes optimistes et atomicité

Ajouter contribution, dépense, todo ou compensation doit idéalement : valider localement, écrire transactionnellement en local, mettre à jour les vues matérialisées locales, afficher immédiatement, mettre l'opération en queue de sync, synchroniser ensuite et réconcilier proprement en cas d'erreur.

Les changements couplés doivent employer batch/transaction/opération métier atomique. Une dépense ne peut pas exister côté autorité avec balance/revision incohérente.

## 8. Firebase/Firestore = adapter

Si Firebase/Firestore est utilisé : conserver ports/repos ; aucun type Firestore dans le domaine ; aucune logique comptable dans React ; aucune logique produit directement dépendante de Firebase. Les adapters locaux doivent permettre de tester le produit sans cloud.

Ne pas créer une Cloud Function par geste. Une fonction distante doit être justifiée par sécurité, secret, autorité/atomicité serveur, validation non fiable côté client, traitement différé ou analytics contrôlée.

## 9. Conflits multi-appareils

Prévoir explicitement : ajouts simultanés, même entrée modifiée sur deux appareils, suppression offline, retour après plusieurs semaines, invitation acceptée pendant d'autres changements. Les opérations comptables ne doivent jamais être perdues par un simple last-write-wins aveugle. Quand la fusion n'est pas sûre, conserver les versions nécessaires et résoudre explicitement/déterministement.

## 10. Sécurité backend

Aucune confiance dans les IDs/champs fournis par le client. Les règles/backend doivent vérifier identité authentifiée, appartenance au groupe, permissions, type de document, champs modifiables, isolation tenant et impossibilité de falsifier une balance sans écriture métier correspondante. Tester des scénarios hostiles.

## 11. Mesurer le coût comme métrique produit

Instrumenter en développement : lectures distantes/session, écritures/action, octets synchronisés, appels de fonctions, événements analytiques, classifications IA effectuées et évitées par cache.

Définir des budgets estimables par utilisateur actif, groupe actif et 1 000 opérations. Une régression de 2 à 200 lectures pour la même action est un finding de release.

Dès qu'un backend réel existe : budget cloud, alertes, quotas raisonnables, monitoring lectures/écritures/fonctions et détection de boucles accidentelles.

## 12. Tests de coût obligatoires

Les quality gates doivent couvrir au minimum :

- ouvrir un groupe avec 50 000 anciennes entrées ne lit pas 50 000 documents distants ;
- naviguer Ajouter → Balances → À faire → Ajouter ne recharge pas les mêmes données quatre fois ;
- une contribution et une dépense ont un nombre d'écritures réseau borné/documenté ;
- sync après trois changements distants ne récupère pas tout l'historique ;
- 10 000 occurrences du même label ne provoquent pas 10 000 classifications IA identiques ;
- sans nouvel événement, l'analytics ne rescane/reclassifie pas massivement l'historique.

## 13. Data : capturer une fois, traiter plus tard

La valeur data ne justifie pas une infrastructure analytics coûteuse en continu. L'Operational Store capture les faits nécessaires au produit. La pipeline analytics est asynchrone, incrémentale, batchée et désactivable. Le produit doit fonctionner parfaitement si l'analytics est arrêtée pendant un mois.

Ne pas dupliquer chaque événement vers Firestore + plusieurs plateformes analytics + research DB sans nécessité. Une opération métier structurée et fiable doit servir de source downstream.

Extraction analytics par checkpoint/revision uniquement. Les corrections/modifications doivent être détectables. Reprocessing complet seulement pour migration, changement de taxonomie/classifieur, audit ou décision explicite.

## 14. Texte libre et classification

Le texte libre opérationnel reste autorisé (`aspi`, `qspi`, `aspi salon`, etc.). Ne jamais imposer une taxonomie UX pour faciliter l'analytics.

Pipeline conceptuelle : `Raw Operational Event → Semantic Classification → Privacy Transform → Research Fact → Aggregation → Privacy Release Gate`.

La classification peut dériver catégorie canonique, sous-catégorie, zone/pièce, portée, langue, confiance, taxonomyVersion et classifierVersion. Le texte brut ne sort jamais dans le produit de données externe.

Normaliser seulement ce qui est sûr avant classification : trim, Unicode, espaces et représentation interne appropriée ; ne pas supprimer de termes susceptibles de changer le sens.

## 15. Classifier une seule fois autant que possible

Créer un cache de classification basé sur représentation normalisée + langue + version taxonomie + version modèle. Ne jamais payer deux fois une classification identique lorsque la réutilisation est sémantiquement sûre.

Ordre recommandé : cache exact → dictionnaire/taxonomie connue → classifieur léger → IA seulement pour inconnu/ambigu. Jamais de LLM synchrone lors de la validation d'une tâche. Les nouveaux labels sont mis en file logique et traités par batch à intervalle/volume raisonnable.

Chaque dérivation conserve `taxonomyVersion`, `classifierVersion`, `confidence`, `processedAt`.

## 16. Privacy transform séparée de la classification

La classification sémantique et l'anonymisation sont deux étapes différentes. Le classifieur peut accéder au texte brut dans un environnement contrôlé ; ensuite la Privacy Transform retire texte brut, IDs opérationnels, noms, emails, device IDs, IP, précision temporelle/géographique inutile et autres quasi-identifiants inutiles.

Le Research Analytics Store reçoit des faits minimisés, jamais une copie de l'entité opérationnelle. Exemple de dimensions admissibles selon justification : type, catégorie, unité, valeur, beneficiaryCount, groupSizeBucket, weekday, timeBucket, pays, planned, taxonomyVersion.

Préserver et étendre l'architecture privacy V2 : consent policy, taxonomy, pipeline, privacy gate, differential privacy, query budget, buyer contracts, audit log. Un hash d'ID n'est jamais considéré anonymisant à lui seul.

## 17. Minutes, points, fréquence et rollups

Toujours conserver l'unité originale. Ne jamais comparer directement les points entre groupes. Les analyses inter-groupes de charge utilisent surtout Minutes lorsque méthodologiquement défendable ; les Points peuvent alimenter fréquence, répartition interne, longitudinal et usage produit.

La fréquence est de premier ordre : nombre de réalisations, intervalle, saisonnalité, weekday/time bucket, catégories, évolution, répartition, planifié/spontané, composition générale lorsqu'elle est collectée légalement.

À grande échelle, créer seulement les rollups prouvés utiles (catégorie/jour ou semaine, pays/mois, taille de groupe/catégorie/période). Pas de streaming/Kafka-like prématuré ; batch hourly/daily/weekly selon besoin.

## 18. Rétention et reprocessing

Politiques distinctes pour Operational Store, workspace temporaire de classification, Research Analytics Store et releases externes. Les données brutes temporaires sont supprimées dès qu'elles ne sont plus nécessaires selon la politique applicable.

Avant de retraiter massivement avec une nouvelle IA : mesurer le gain sur échantillon, identifier les catégories affectées, estimer le coût, décider, batcher et versionner.

## 19. Minimisation de collecte

Ne pas collecter « au cas où » contacts, GPS précis, advertising ID, browsing, photos, micro, données tierces ou fingerprint appareil détaillé sans justification produit/data explicite et légale. La valeur vient de répétition, longitudinalité, structure, fréquence et taille d'échantillon.

## 20. Multi-devise

Conserver la devise originale de chaque dépense. Ne jamais mélanger CHF/EUR/USD silencieusement. Une future conversion doit conserver taux, source, date, montant original et montant converti. Pas d'API FX payante avant besoin réel.

## 21. Cost regression gate

Un critère ne peut être accepté s'il réintroduit : full scan, listener permanent injustifié, IA synchrone, duplication systématique d'événements, appels réseau à chaque render, rechargement d'objets locaux, ou coût d'une action courante proportionnel à l'historique total.

Les Auditors traitent ces violations comme des findings de release obligatoires.
