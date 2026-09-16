# ChoreScore V3 — Roadmap canonique

La factory avance un seul critère cohérent à la fois. Chaque critère reste `in_progress` tant qu'un Auditor indépendant n'a pas accepté le candidat avec vérification trusted verte. Un `repair` conserve le code candidat comme baseline WIP. Aucun critère terminé ne peut régresser.

`docs/V3_CONSTITUTION.md` et `docs/V3_BACKEND_FRUGAL.md` sont tous deux canoniques et additifs.

## V3-01 — Domaine, doubles ledgers et invariants
Finaliser le modèle déjà amorcé : ContributionEntry générique Minutes|Points, ExpenseEntry, CrossLedgerSettlement, validation partagée, replay edit/delete, périodes comme vues seulement et tests de propriété/invariants. Les sommes doivent rester nulles. Les devises et unités historiques restent distinctes. Préparer les contrats de révision/tombstone nécessaires à une future sync auditable sans coupler le domaine à Firebase.

## V3-02 — Structure application, design V3 et socle local-first
Migrer sélectivement le squelette Expo/Router/AppContext/ports/adapters V2. Racine Groupes illimités et trois onglets Ajouter, Balances, À faire. Installer le langage visuel graphite/off-white/métallique. Supprimer toute trace comportementale Premium/paywall/chrono. Installer le socle local-first : stockage métier indexé (préférence `expo-sqlite`), repositories locaux et UI lisant le local sans requêtes cloud obligatoires au changement d'écran/onglet.

## V3-03 — Ajouter + historique
Construire le switch Contribution|Dépense dans le même produit. Contribution libre + PersistentTask sans chrono ; dépense Tricount-like égal/custom ; historique compact unifié, édition/suppression et recalculs fiables. Les écritures sont optimistes et transactionnelles en local ; l'historique est paginable et cacheable, pas rechargé intégralement.

## V3-04 — Balances + compensation
Faire évoluer Score en Balances : ledger contribution et ledger argent distincts, période/all-time, suggestions de règlement, historique et compensation inter-ledgers manuelle seulement, avec taux du groupe et snapshot immuable. Les balances courantes sont des vues matérialisées dérivées/reconstruisibles du ledger, jamais recalculées en rejouant tout l'historique à chaque affichage.

## V3-05 — À faire
Migrer Todo gratuitement. Complétion atomique vers exactement une ContributionEntry. Rappels/calendrier via ports honnêtes. Aucun chrono. La complétion doit rester cohérente en local/offline et intégrer proprement la queue de sync.

## V3-06 — Groupes, invitations, identité, sync et backend frugal
Multi-groupes illimités, identité stable, invitation par lien/partage/acceptation, tenant isolation, persistance/sync/offline, options unité/compensation. Réutiliser les abstractions V2 solides sans billing. Implémenter sync delta-only avec révisions/cursors par groupe, signal de changement léger si temps réel, aucun N+1, aucun full scan, opérations couplées atomiques, conflits multi-appareils déterministes, règles backend hostiles et Firebase/Firestore uniquement comme adapter.

## V3-07 — Data product frugal
Migrer et étendre `src/analytics` V2 : consent, taxonomy/classifier downstream versionné, privacy pipeline, query budget, DP, release gate, buyer contracts, audit log. Étendre aux contributions, dépenses, settlements et usage sans exporter texte libre ni identifiants opérationnels. Pipeline asynchrone, incrémentale/checkpointée et batchée ; cache de classification ; règles/classifieur léger avant IA ; aucun LLM synchrone ; aucune double collecte inutile ; Research Facts minimisés ; rétention/reprocessing contrôlés.

## V3-08 — Finition, coût et release
Couvrir tous les états obligatoires de la constitution, accessibilité/large text, localisation, offline, erreurs, énorme historique, audit visuel, E2E. Ajouter les tests de coût et de non-régression réseau : 50k anciennes entrées sans 50k reads, tab-switch sans reloads répétés, sync de quelques deltas sans full history, writes bornés, classification cache, analytics no-op sans nouvel événement. Le Builder prépare les scripts et corrige le produit. Après audit accepté, le trusted finalizer seul peut marquer V3-08 `complete` après checks produit/privacy/coût, APK/install/lancement/golden path et vérification iOS readiness.

## Règles transversales
- V3 est une migration sélective : inspecter `v2-reference/lab/chorescore-v2` quand utile, sans recopier les hypothèses V2 obsolètes.
- L'app est toujours 100 % gratuite.
- Les deux ledgers sont indépendants par défaut.
- L'historique est le registre ; les vues UI n'en sont jamais la source de vérité.
- Une unité de groupe changée ne réécrit jamais l'historique.
- **Write once. Sync deltas. Read local. Derive incrementally. Classify once. Aggregate later.**
- Une action courante ne peut pas avoir un coût proportionnel à l'historique total.
- Le design fini est une gate : pas d'écran template/générique provisoire considéré terminé.
- Les tests de coût sont des quality gates dès que persistance/sync/analytics entrent en jeu.
- Deux cycles consécutifs non acceptés sans aucun delta produit mettent la factory en `STALLED` pour éviter une boucle stérile.
