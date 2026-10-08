# ChoreScore V4 — Roadmap canonique

V4 part de la V3 RC validée et avance critère par critère. Un critère accepté ne régresse jamais. Un `repair` conserve le delta sûr comme baseline WIP.

## V4-01 — Domaine V4 et migration sûre
Étendre le domaine V3 avec catégories libres, membres nommés/non liés, ratio de catégorie par défaut snapshoté, attachments note/photo, Todo kind task|expense et vocabulaire Task côté présentation sans casser les ledgers existants.

Acceptation : `typecheck/tests verts` ; `invariants V3 préservés` ; `Category sans seed obligatoire` ; `named member distinct de linked identity` ; `task split custom exact et snapshot du ratio de catégorie` ; `attachments provider-agnostic` ; `Todo task|expense atomique` ; `aucune réinterprétation historique`.

## V4-02 — Design chaud V2, i18n et shell V4
Revenir à la palette V2 exacte, installer une UI V4 soignée, safe-area correcte, FR/EN sans chaînes visibles hardcodées, accents français corrects et Options générales accessibles depuis Groupes.

Acceptation : `palette canonique V2` ; `FR et EN complets sur parcours principal` ; `accents français corrects` ; `aucune chaîne critique hardcodée` ; `safe areas Android/iOS` ; `Options générales en bas de Groupes` ; `aucune UX Premium/Demo/email login`.

## V4-03 — Auth sociale, session, groupes et membres
Flux normal avec Google/Apple/Facebook derrière ports, session persistée, arrivée directe Groupes après première connexion, création de groupe avec membres nommés, ajout ultérieur, Options conservé et invitation par lien uniquement après création.

Acceptation : `aucun bouton Démo/email-password normal` ; `auth adapters honnêtes` ; `mode E2E secretless invisible` ; `session persistée vers Groupes` ; `création groupe avec plusieurs membres` ; `member count visible` ; `aucun bouton Inviter sur carte groupe` ; `ajout membre post-création` ; `lien invitation + native share`.

## V4-04 — Ajouter — Tâches, Dépenses, catégories, notes et photos
L'onglet Ajouter expose Tâche|Dépense, catégories libres gérées sous l'action, membres à la place de l'ancien historique, split custom des tâches/dépenses, ratio de catégorie par défaut, notes/photos et partage natif.

Acceptation : `UI dit Tâche jamais Contribution` ; `aucune catégorie seed imposée` ; `création/renommage/suppression catégorie sûre` ; `split task égal/custom` ; `ratio catégorie par défaut overrideable` ; `split dépense égal/custom exact` ; `note/photo task et dépense` ; `section Membres remplace historique` ; `share sheet native`.

## V4-05 — Balances — historique, édition, suppression et partage
Balances centralise les deux ledgers et l'historique paginé. Toute Tâche/Dépense peut être ouverte, modifiée, supprimée par replay/tombstone et partagée depuis Balances.

Acceptation : `blocs Tâches et Dépenses distincts` ; `historique paginé` ; `edit tâche depuis Balances` ; `edit dépense depuis Balances` ; `delete replay/tombstone correct` ; `share natif depuis Balances` ; `périodes restent vues` ; `compensation V3 préservée`.

## V4-06 — À faire — Tâche ou Dépense
À faire crée des items typés Tâche ou Dépense et leur complétion produit exactement une écriture ledger correspondante avec les champs nécessaires, offline-safe et atomique.

Acceptation : `todo task` ; `todo expense` ; `complétion task exactement une écriture` ; `complétion expense exactement une écriture` ; `montant/devise confirmés pour expense` ; `split/bénéficiaires confirmés` ; `note/photo compatibles` ; `offline atomicité`.

## V4-07 — Sync, pièces jointes, privacy et coût
Étendre le backend frugal V3 aux catégories, membres nommés, invitations, notes/photos et todo-expense sans full scans ni fuite privacy. Photos lazy, métadonnées bornées, analytics sans texte/note/photo/IDs.

Acceptation : `delta-only préservé` ; `aucun N+1/full scan` ; `photos lazy sans bulk history download` ; `conflicts déterministes` ; `tenant isolation` ; `notes/photos exclus analytics` ; `catégories normalisées downstream sans raw export` ; `privacy gate vert` ; `cost gate étendu`.

## V4-08 — Polish complet, légal, accessibilité et états
Finir tous les états V4, options générales/groupe, légal, erreurs, offline, large text, FR/EN, longs labels, photos manquantes, invitations, huge history et cohérence visuelle adulte/chaleureuse.

Acceptation : `états obligatoires constitution couverts` ; `accessibilité/grands textes` ; `FR/EN visuellement audités` ; `légal accessible` ; `offline/persistence errors` ; `empty/loading/error states` ; `safe area tabs` ; `design cohérent et fini`.

## V4-09 — Release mobile et golden path V4
Finaliser la release selon V4_RELEASE_ENGINEERING : gates produit/privacy/coût/i18n, exports Android/iOS, x86_64 API35 golden path réel, puis APK arm64-v8a final hashé et uploadé.

Acceptation : `tests/privacy/cost/i18n verts` ; `Expo Android+iOS exports` ; `x86_64 release install API35` ; `golden path V4 complet` ; `aucun label interdit visible` ; `arm64-v8a release APK` ; `SHA-256` ; `artifact 30 jours` ; `aucun finding ouvert`.

## Règles transversales
- Sources : V4_CONSTITUTION + V4_RELEASE_ENGINEERING + V3_BACKEND_FRUGAL.
- V4 est gratuite et sans chrono/paywall.
- "Contribution" est un détail historique interne toléré seulement si nécessaire ; l'UI dit Tâche/Task.
- Catégories libres uniquement.
- FR/EN et accents corrects sont des gates.
- La V3 stable n'est jamais modifiée.
- Le finalizer seul marque V4-09 complete.
