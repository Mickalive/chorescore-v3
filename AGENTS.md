# ChoreScore V4 — règles des agents

- Lire intégralement `docs/V4_CONSTITUTION.md`, `docs/V4_RELEASE_ENGINEERING.md`, `docs/V3_BACKEND_FRUGAL.md`, `governance/RELEASE_DEFINITION.json`, `docs/ROADMAP.md`, `docs/RELEASE_STATUS.json` et `directives/TASKS.json` avant toute modification.
- V4 est une migration de la V3 RC validée, pas un greenfield. Réparer/étendre l'existant et conserver les fondations V3 correctes.
- La branche V3 reste une référence stable. Ne jamais la modifier.
- Le Builder ne modifie pas les fichiers de contrôle : MAIN_PROMPT.md, AGENTS.md, governance/**, directives/**, docs/V4_CONSTITUTION.md, docs/V4_RELEASE_ENGINEERING.md, docs/V3_BACKEND_FRUGAL.md, docs/ROADMAP.md, docs/RELEASE_STATUS.json, docs/NEXT_CYCLE.md, .github/**, .opencode/**, opencode.json, reports/**.
- L'Auditor n'édite jamais le produit. Le Director ne modifie que l'état dynamique, les tâches et ses rapports.
- Un candidat `repair` cohérent est conservé comme baseline WIP. Ne jamais reconstruire un critère déjà accepté.
- Aucun faux OAuth, share, photo, sync, push ou analytics. Les intégrations non configurées restent honnêtes derrière ports/adapters.
- Le build E2E peut utiliser une session locale déterministe invisible dans un build normal. Aucun bouton Démo dans l'UI normale.
- L'UI finale ne doit contenir ni Contribution, Premium, Standard, Pro, abonnement, paywall, chrono ou catégories imposées.
- Les chaînes visibles passent par i18n FR/EN. Les accents français sont obligatoires.
- Palette V2 canonique : terracotta/cream/sage telle que définie dans V4_CONSTITUTION.
- Tâches : split égal/custom, ratio de catégorie par défaut snapshoté, note/photo facultatives.
- Dépenses : split égal/custom exact, note/photo facultatives, devise conservée.
- Catégories libres seulement. Aucune seed "Vaisselle".
- Modifications/suppressions/partages d'écritures sous Balances.
- À faire supporte Tâche et Dépense, complétion atomique.
- Invitation uniquement après création de groupe, via lien + share sheet native.
- Conserver les invariants : tâche/contribution somme nulle ; argent somme nulle par devise ; unités historiques non réinterprétées ; compensation explicite avec snapshot.
- Architecture : local-first, SQLite/indexé, delta-only, pas de full scans/N+1/listeners massifs, balances matérialisées reconstruisibles, historique paginé, writes optimistes, conflits auditables.
- Notes/photos/texte libre/IDs ne sortent jamais dans le Research Analytics Plane.
- Les tests de coût, privacy, i18n, accessibilité et builds sont des critères de correction.
- Pour Android : respecter safe areas et cliquer les contrôles d'onglet réels dans E2E, pas le texte dans la barre système.
- Ne jamais inventer une preuve. Un critère n'est accepté que si la vérification trusted est verte.

- `docs/CI_EFFICIENCY_POLICY.md` est canonique pour toute automation : déterministe avant LLM, artifact/cache avant rebuild, delta ciblé avant full gates, retries bornés, aucune revalidation identique sans justification.
- Une panne harness/infra ne doit jamais repasser par la Factory produit complète si elle peut être réparée/rejouée sur le même artifact. Les probes multi-modèles et Directors LLM sont des fallbacks exceptionnels, pas des étapes de routine.
