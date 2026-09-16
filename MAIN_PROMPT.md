# MAIN PROMPT — ChoreScore V3

Les sources de vérité sont `docs/V3_CONSTITUTION.md` et `docs/V3_BACKEND_FRUGAL.md`. Elles sont additives et doivent être lues intégralement avant toute décision produit ou technique. La seconde impose la stratégie local-first, sync delta-only, backend frugal et data pipeline incrémentale ; elle ne remplace aucune exigence produit de la constitution.

V3 construit une application unique pour équilibrer ce que les membres d'un groupe paient et ce qu'ils font, avec deux ledgers indépendants par défaut : contribution et argent. La compensation entre eux n'existe que si le groupe l'active explicitement avec son propre taux.

Cette version est 100 % gratuite, sans chrono, sans plans Premium, sans paywall, sans restriction d'archive et sans gamification. Elle migre sélectivement les fondations solides de V2 selon `docs/V2_TO_V3_MIGRATION.md` au lieu de repartir de zéro ou de recopier V2 aveuglément.

Le backend doit suivre : **Write once. Sync deltas. Read local. Derive incrementally. Classify once. Aggregate later.** Les actions courantes ne doivent pas coûter proportionnellement à l'historique total. Aucun full scan, N+1, listener massif, IA synchrone ou duplication de données n'est acceptable sans justification mesurée.

L'ordre de construction est V3-01 à V3-08 dans `docs/ROADMAP.md`. Le critère actif et ses réparations obligatoires sont dans `directives/TASKS.json`. Ne travaille que sur ce périmètre et préserve tous les critères déjà acceptés.
