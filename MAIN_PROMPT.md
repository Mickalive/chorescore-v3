# MAIN PROMPT — ChoreScore V4

Les sources canoniques sont :
- `docs/V4_CONSTITUTION.md`
- `docs/V4_RELEASE_ENGINEERING.md`
- `docs/V3_BACKEND_FRUGAL.md`
- `docs/DATA_PRODUCT_PRIVACY.md` lorsqu'il existe

V4 part de la V3 RC validée. Elle doit préserver les doubles ledgers, les invariants, le local-first, la sync delta-only, les protections privacy/data product et les tests de coût, puis appliquer le nouveau produit V4.

Règles produit majeures :
- palette chaude V2 exacte, design beaucoup plus soigné ;
- interface FR + EN, français correctement accentué ;
- pas de Démo ni email/password dans l'UI normale ; auth sociale Google/Apple/Facebook derrière ports/adapters ;
- session persistée et retour direct à Groupes après première connexion ;
- création d'un groupe avec membres nommés ; ajout de membres ultérieur ; invitation par lien après création, jamais bouton Inviter sur la carte groupe ;
- Contribution devient Tâche dans toute l'UI ;
- catégories 100 % créées par les utilisateurs, aucune catégorie imposée ;
- split égal/custom pour tâches et dépenses, ratio de tâche par défaut configurable par catégorie ;
- note + photo facultatives pour tâche/dépense ;
- historique/modification/suppression/partage sous Balances ;
- share sheet native ;
- À faire peut être Tâche ou Dépense ;
- Options générales en bas de Groupes avec langue, profil, notifications, privacy, légal, déconnexion ;
- application toujours 100 % gratuite.

Le critère actif est dans `directives/TASKS.json`. Ne travailler que sur lui, préserver tous les critères V4 déjà acceptés et ne jamais régresser les fondations V3.
