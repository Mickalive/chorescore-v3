# ChoreScore V3 — Roadmap canonique

La factory avance un seul critère cohérent à la fois. Chaque critère reste `in_progress` tant qu'un Auditor indépendant n'a pas accepté le candidat avec vérification trusted verte. Un `repair` conserve le code candidat comme baseline WIP. Aucun critère terminé ne peut régresser.

## V3-01 — Domaine, doubles ledgers et invariants
Finaliser le modèle déjà amorcé : ContributionEntry générique Minutes|Points, ExpenseEntry, CrossLedgerSettlement, validation partagée, replay edit/delete, périodes comme vues seulement et tests de propriété/invariants. Les sommes doivent rester nulles. Les devises et unités historiques restent distinctes.

## V3-02 — Structure application et design V3
Migrer sélectivement le squelette Expo/Router/AppContext/ports/adapters V2. Racine Groupes illimités et trois onglets Ajouter, Balances, À faire. Installer le langage visuel graphite/off-white/métallique. Supprimer toute trace comportementale Premium/paywall/chrono.

## V3-03 — Ajouter + historique
Construire le switch Contribution|Dépense dans le même produit. Contribution libre + PersistentTask sans chrono ; dépense Tricount-like égal/custom ; historique compact unifié, édition/suppression et recalculs fiables.

## V3-04 — Balances + compensation
Faire évoluer Score en Balances : ledger contribution et ledger argent distincts, période/all-time, suggestions de règlement, historique et compensation inter-ledgers manuelle seulement, avec taux du groupe et snapshot immuable.

## V3-05 — À faire
Migrer Todo gratuitement. Complétion atomique vers exactement une ContributionEntry. Rappels/calendrier via ports honnêtes. Aucun chrono.

## V3-06 — Groupes, invitations, identité
Multi-groupes illimités, identité stable, invitation par lien/partage/acceptation, tenant isolation, persistance/sync/offline, options unité/compensation. Réutiliser les abstractions V2 solides sans billing.

## V3-07 — Data product
Migrer et étendre `src/analytics` V2 : consent, taxonomy/classifier downstream versionné, privacy pipeline, query budget, DP, release gate, buyer contracts, audit log. Étendre aux contributions, dépenses, settlements et usage sans exporter texte libre ni identifiants opérationnels.

## V3-08 — Finition et release
Couvrir tous les états obligatoires de la constitution, accessibilité/large text, localisation, offline, erreurs, énorme historique, audit visuel, E2E. Le Builder prépare les scripts et corrige le produit. Après audit accepté, le trusted finalizer seul peut marquer V3-08 `complete` après APK/install/lancement/golden path et vérification iOS readiness.

## Règles transversales
- V3 est une migration sélective : inspecter `v2-reference/lab/chorescore-v2` quand utile, sans recopier les hypothèses V2 obsolètes.
- L'app est toujours 100 % gratuite.
- Les deux ledgers sont indépendants par défaut.
- L'historique est le registre ; les vues UI n'en sont jamais la source de vérité.
- Une unité de groupe changée ne réécrit jamais l'historique.
- Le design fini est une gate : pas d'écran template/générique provisoire considéré terminé.
- Deux cycles consécutifs non acceptés sans aucun delta produit mettent la factory en `STALLED` pour éviter une boucle stérile.
