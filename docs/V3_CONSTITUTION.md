# ChoreScore V3 — constitution produit et technique

## 0. MISSION ET SOURCE DE VÉRITÉ

La V3 est construite dans `Mickalive/chorescore-v3`, avec comme dépôt de référence de migration :

- repository upstream : `Mickalive/Chorescore-V2`
- branche de référence : `lab/chorescore-v2`

La V3 n'est PAS un greenfield rebuild.

La V2 possède déjà :

- une architecture domaine/application/infrastructure/UI ;
- une navigation Expo Router ;
- une racine de groupes/foyers ;
- une logique `fait par / fait pour` ;
- un ledger de contribution zéro-somme ;
- un historique transactionnel ;
- des PersistentTask ;
- un planning To-do ;
- invitations, partage, persistence, sync abstraite, permissions ;
- une architecture analytics/research/privacy très avancée ;
- tests unitaires, acceptance tests, E2E et audit visuel ;
- une factory multi-agents Builder / Auditor / Director.

La priorité de V3 est de **faire migrer ce produit**, pas d'inventer une nouvelle application générique.

Avant toute modification substantielle, lire impérativement dans la V2 :

- `MAIN_PROMPT.md`
- `AGENTS.md`
- `docs/PRODUCT_BLUEPRINT.md`
- `docs/DESIGN_BRIEF.md`
- `docs/DESIGN_CONTRACT.md`
- `docs/DATA_PRODUCT_PRIVACY.md`
- `docs/QUALITY_GATES.md`
- `docs/architecture.md`
- `src/domain/entities/index.ts`
- `src/domain/calculations/score.ts`
- `src/application/use-cases/ChoreScoreApp.ts`
- `src/features/household/AddTaskScreen.tsx`
- `src/features/household/ScoreScreen.tsx`
- `src/features/household/TodoScreen.tsx`
- `src/ui/design-system/theme.ts`
- `src/analytics/*`
- les scénarios/tests V2 existants.

Inspecter également les références visuelles sous `audit/visual-evidence/`.

La V3 doit être reconnaissable comme l'évolution de la V2 dans sa structure et sa densité, pas comme une nouvelle app sortie d'un template.

---

# 1. NOUVELLE THÈSE PRODUIT

La V2 était :

> « Le Tricount du temps domestique. »

La V3 devient :

> **Un seul endroit pour équilibrer ce que les membres d'un groupe paient et ce qu'ils font.**

Le produit réunit deux systèmes distincts :

1. **ledger de contribution**
2. **ledger financier**

Ils restent séparés par défaut.

L'utilisateur peut facultativement activer une compensation entre les deux.

La V3 doit pouvoir remplacer à la fois :

- une application type Tricount pour les dépenses ;
- une application de répartition des tâches/contributions.

L'application est **100 % gratuite**.

Il n'existe plus :

- Free vs Premium ;
- Standard ;
- Pro ;
- paywall ;
- archive payante ;
- fonction réservée à un abonnement ;
- badge de plan ;
- upsell.

Toute fonctionnalité produit pertinente est accessible à tous.

Ne pas conserver artificiellement une logique d'entitlements qui complique le produit simplement parce qu'elle existait en V2.

En revanche, migrer proprement : ne pas casser l'architecture ni les tests sans comprendre leurs dépendances.

---

# 2. LE PRODUIT N'EST PLUS LIMITÉ AU « FOYER »

La V2 utilise techniquement le concept `Household`.

La V3 doit pouvoir représenter :

- couple ;
- famille ;
- colocation ;
- vacances ;
- voyage ;
- groupe d'amis ;
- résidence partagée ;
- tout petit groupe partageant dépenses et/ou contributions.

Un groupe peut parfaitement utiliser :

- uniquement les dépenses ;
- uniquement les tâches ;
- les deux.

Il ne faut donc pas obliger l'utilisateur à configurer des tâches lorsqu'il veut seulement partager les dépenses d'un voyage.

Pour limiter le risque de migration, le nom interne `Household` peut temporairement être conservé dans le domaine lorsque son remplacement n'apporte rien.

En revanche, l'interface utilisateur doit progressivement employer un terme générique comme **Groupe** plutôt que supposer systématiquement une résidence permanente.

---

# 3. CONSERVER LA GRAMMAIRE DE NAVIGATION V2

La V2 utilise :

`Ajouter une tâche | Score | To-do`

La V3 doit conserver **la structure compacte à trois onglets**, plutôt que créer un dashboard générique ou multiplier les vues.

Nouvelle navigation recommandée :

### 1. Ajouter

Saisie rapide d'une contribution OU d'une dépense + historique transactionnel juste en dessous.

### 2. Balances

Remplace conceptuellement `Score`.

C'est le centre de compréhension des deux ledgers :

- contribution ;
- argent ;
- compensations facultatives.

### 3. À faire

Évolution directe du To-do V2.

Conserver l'idée de planning futur, mais adapter la valeur de la tâche à l'unité choisie par le groupe.

Options restent hors de la navigation principale, comme en V2.

Ne pas créer :

- Dashboard ;
- Home interne supplémentaire ;
- onglet Historique séparé ;
- onglet Membres séparé ;
- onglet Statistiques séparé ;
- onglet Profil.

KISS.

---

# 4. RACINE DES GROUPES

Conserver la structure actuelle de `app/index.tsx` :

- identité/application en haut ;
- liste simple des groupes ;
- nom ;
- nombre de membres ;
- ouverture du groupe ;
- accès discret aux options ;
- action `Créer un groupe`.

Supprimer :

- badge Gratuit / Essai / Standard / Pro ;
- bouton Premium ;
- messages de limitation de création liés à l'abonnement.

Un utilisateur peut créer et rejoindre plusieurs groupes gratuitement.

Ajouter un parcours d'invitation réellement utilisable :

- lien d'invitation ;
- partage via share sheet natif ;
- deep link lorsque l'infrastructure le permet ;
- acceptation simple ;
- arrivée dans le groupe avec identité stable.

Réutiliser et étendre l'actuel `LocalInvitationAdapter` / abstraction d'invitation plutôt que créer une logique parallèle.

---

# 5. ONGLET « AJOUTER »

La V2 a déjà la bonne philosophie :

**saisie en haut + historique transactionnel immédiatement dessous.**

Conserver cette composition.

Au sommet de la zone de saisie, ajouter un switch très sobre :

`Contribution | Dépense`

Pas deux applications visuellement séparées.

## 5A. CONTRIBUTION

Évolution directe de `AddTaskScreen.tsx`.

Conserver :

- libellé libre ;
- PersistentTask / raccourcis de tâches ;
- `Fait par` ;
- `Fait pour` ;
- date/heure ;
- modification ;
- suppression ;
- partage ;
- historique juste dessous.

### SUPPRESSION ABSOLUE DU CHRONO

Supprimer :

- `ChronoTimer` ;
- état chrono ;
- start/stop chrono ;
- toute notion de durée réellement chronométrée.

V3 ne mesure jamais automatiquement le temps passé.

### UNITÉ DE CONTRIBUTION

Chaque groupe choisit son unité :

- **Minutes** ;
- **Points**.

Le choix initial se fait lors de la création/configuration du groupe.

Il reste modifiable dans les options du groupe.

Aucune unité n'est considérée moralement ou méthodologiquement supérieure dans l'UX.

### Mode Minutes

L'utilisateur attribue librement une valeur à la tâche.

Exemples :

- Vaisselle → 15 min ;
- Courses → 45 min ;
- Aspirateur → 30 min.

Ce sont des **minutes attribuées par le groupe**, PAS une durée chronométrée et PAS une durée « standard » imposée par ChoreScore.

### Mode Points

Même fonctionnement :

- Vaisselle → 3 points ;
- Courses → 10 points ;
- Aspirateur → 6 points.

Les points sont définis librement par le groupe.

### PersistentTask

Conserver le concept existant.

Une PersistentTask peut mémoriser :

- libellé ;
- valeur par défaut ;
- unité issue du groupe ;
- bénéficiaires par défaut si pertinent ;
- éventuelle récurrence/planning.

Elle sert à accélérer la saisie.

Elle ne doit jamais devenir une taxonomie obligatoire.

L'utilisateur reste libre d'écrire :

- `Aspi` ;
- `qspi` ;
- `coup d'aspi salon` ;
- `Courses Aldi` ;
- n'importe quel texte.

Ne pas dégrader l'UX afin de rendre les données analytiques plus propres.

---

# 6. LEDGER DE CONTRIBUTION

La logique zéro-somme de V2 est une bonne fondation et doit être conservée/généralisée.

Pour une contribution de valeur `V` :

- exécutée par `P` ;
- au bénéfice de `N` membres ;

`P` reçoit le crédit de contribution ; la charge est répartie entre les bénéficiaires.

Si l'exécutant fait partie des bénéficiaires, sa propre part se compense naturellement.

La somme des balances du groupe reste toujours égale à zéro.

Cette logique fonctionne indifféremment avec :

- minutes ;
- points.

### IMPORTANT : BALANCE PERSISTANTE

La V2 permet des vues Semaine / Mois / Année / Depuis le début.

Ces filtres peuvent rester pour l'analyse.

Mais la **balance principale de contribution est perpétuelle**.

Elle :

- ne se remet jamais à zéro automatiquement ;
- ne repart jamais à zéro en début de semaine ;
- ne repart jamais à zéro en début de mois.

Une période n'est qu'une VUE sur les écritures du ledger.

L'utilisateur peut éventuellement créer explicitement un règlement/ajustement s'il veut repartir d'un accord nouveau.

Toute remise à zéro volontaire doit créer une trace comptable plutôt que détruire l'historique.

---

# 7. DÉPENSES — SECOND LEDGER

Ajouter un vrai module de dépenses inspiré du modèle mental Tricount.

Une dépense contient au minimum :

- titre libre ;
- montant ;
- devise ;
- payé par ;
- payé pour / participants ;
- répartition ;
- date/heure ;
- note facultative ;
- catégorie facultative ;
- `createdBy / modifiedBy`.

Répartition :

- égale ;
- personnalisée.

Prévoir une architecture extensible vers :

- parts ;
- pourcentages ;
- montants individuels ;

sans surcharger le premier formulaire.

### Ledger financier

Chaque dépense crée les écritures correspondantes.

Le ledger financier doit :

- être zéro-somme ;
- afficher ce que chaque membre doit/avance ;
- produire des compensations pair-à-pair simples ;
- conserver toute l'histoire ;
- permettre correction/suppression en recalculant correctement les balances.

Le fonctionnement financier doit être indépendant du ledger de contribution.

Un groupe peut utiliser les dépenses sans utiliser les tâches.

---

# 8. COMPENSATION ENTRE ARGENT ET CONTRIBUTION

C'est une fonctionnalité différenciante importante.

PAR DÉFAUT :

> Argent et contribution restent deux comptes séparés.

Aucune conversion implicite.

Dans les Options du groupe, les membres peuvent activer :

**Autoriser la compensation entre argent et contribution**

Le groupe définit alors lui-même le taux.

Exemples :

- 60 minutes = CHF 20 ;
- 10 points = CHF 15.

ChoreScore n'impose jamais une valeur monétaire au travail.

### Compensation manuelle

Ajouter une action `Compenser`.

L'utilisateur choisit :

- combien de crédit/dette de contribution utiliser ;
- quel montant financier cela représente selon le taux du groupe.

Avant validation, afficher :

**Avant**

- Argent ;
- Contribution.

**Après**

- Argent ;
- Contribution.

Une compensation validée devient une vraie écriture historique immutable/auditable de type `CrossLedgerSettlement`.

Stocker :

- taux utilisé à l'instant T ;
- valeur source ;
- valeur cible ;
- membres concernés ;
- auteur ;
- timestamp.

Une modification ultérieure du taux ne doit jamais réécrire rétroactivement une ancienne compensation.

---

# 9. ONGLET « BALANCES »

Faire évoluer `ScoreScreen.tsx`, NE PAS créer un dashboard concurrent.

La V2 possède déjà :

- filtres temporels ;
- soldes ;
- propositions de compensation ;
- barres ;
- historique filtré ;
- partage.

Réutiliser ces fondations.

Le haut de l'écran doit répondre immédiatement :

> Qui est en avance ou en retard ?

Mais désormais sur deux dimensions.

Présentation possible :

### Contribution

Alex `+ 1 h 20`

Marie `− 1 h 20`

ou :

Alex `+ 18 pts`

Marie `− 18 pts`

### Argent

Alex `− CHF 42.50`

Marie `+ CHF 42.50`

Les deux blocs restent visuellement distincts.

Si compensation croisée activée : action secondaire discrète `Compenser`.

### Couleurs

Valeur positive : **vert foncé, désaturé**.

Valeur négative : **bordeaux foncé, désaturé**.

Le rouge/vert n'est jamais utilisé comme décoration générale.

Les noms restent les identifiants principaux.

Ne jamais transformer cela en classement, podium ou compétition.

### Périodes

Conserver :

- Semaine ;
- Mois ;
- Année ;
- Depuis le début.

Mais :

- toutes les périodes sont gratuites ;
- aucune archive n'est verrouillée ;
- la balance perpétuelle principale doit rester identifiable.

### Filtres

Conserver les filtres issus des PersistentTask pour les contributions.

Ajouter les filtres utiles aux dépenses sans construire une usine à gaz.

L'historique filtré reste au bas de l'écran.

---

# 10. HISTORIQUE

La V2 traite déjà l'historique comme une liste de transactions.

Conserver exactement cette philosophie.

Chaque ligne doit être compacte.

### Contribution

Priorité :

- libellé ;
- valeur ;
- fait par ;
- fait pour ;
- date.

### Dépense

Priorité :

- libellé ;
- montant ;
- payé par ;
- participants ;
- date.

### Compensation

Afficher explicitement qu'il s'agit d'une compensation entre ledgers.

Le flux principal de l'onglet Ajouter peut mélanger les types, avec identification visuelle extrêmement sobre.

Permettre filtre :

- Tout ;
- Contributions ;
- Dépenses ;
- Compensations.

Pas de mini-cartes complexes pour chaque ligne.

---

# 11. TO-DO / À FAIRE

Réutiliser `TodoScreen.tsx`.

Conserver :

- titre ;
- assigné ;
- bénéficiaires ;
- échéance ;
- rappel ;
- note ;
- PersistentTask ;
- création ;
- suppression ;
- complétion via mini-formulaire.

Quand une tâche est terminée :

1. choisir/confirmer `Fait par` ;
2. confirmer sa valeur ;
3. confirmer `Fait pour` ;
4. créer atomiquement la CompletedEntry/ContributionEntry ;
5. mettre à jour le ledger.

Si le groupe est en Minutes : demander une valeur en minutes.

Si le groupe est en Points : demander une valeur en points.

Aucun chrono.

La valeur par défaut peut provenir de la PersistentTask.

Tout le To-do est gratuit.

---

# 12. IDENTITÉ VISUELLE V3

La V2 actuelle est volontairement crème / terracotta / sauge / chaude / « feel-good / self-care ».

La V3 fait volontairement le mouvement inverse.

## Sensation recherchée

Trois mots : **précis · adulte · premium**.

La référence mentale est davantage :

- Apple ;
- bunq / Tricount ;
- outil financier personnel haut de gamme ;
- carnet comptable contemporain.

PAS :

- SaaS dashboard ;
- crypto app ;
- néobanque flashy ;
- app enfant ;
- gamification ;
- self-care ;
- app « charge mentale » militante/moralisatrice.

L'app ne commente pas les relations entre les utilisateurs.

Elle montre des faits.

## Palette

Base :

- noir ;
- blanc cassé / blanc propre ;
- graphite ;
- gris métalliques ;
- argent.

Direction à tester :

- background light proche de `#F5F5F7` ;
- surface `#FFFFFF` ;
- graphite `#171719` ;
- secondary text `#68686D` ;
- metallic border `#D1D1D6`.

États de balance uniquement :

- vert profond / forest green ;
- bordeaux profond / wine red.

Aucune couleur criarde.

Pas de rouge primaire saturé. Pas de vert fluo. Pas de bleu corporate dominant. Pas de terracotta. Pas de peach. Pas de sage décoratif.

## Surfaces

Conserver les qualités de composition V2 :

- peu de cartes ;
- peu d'ombres ;
- densité maîtrisée ;
- formulaires compacts ;
- valeurs immédiatement lisibles ;
- historique transactionnel.

Mais rendre le tout plus net, sobre, précis et « engineered ».

Utiliser :

- séparateurs fins ;
- profondeur très discrète ;
- métalliques subtils ;
- radius cohérents ;
- typographie système premium.

Pas de verre/gradient gratuit juste pour faire « Apple ».

## Motion

Animations très courtes et fonctionnelles :

- changement de balance ;
- validation d'une écriture ;
- switch Contribution/Dépense ;
- ouverture d'un détail.

Aucun confetti. Aucune célébration. Aucun streak. Aucun badge.

---

# 13. COPYWRITING

Supprimer tout vocabulaire chaleureux artificiel, self-care, culpabilisant, ludique, enfantin ou moralisateur.

PAS :

> Bravo !
> Nouveau mois 🌿
> Bien au chaud
> Tu as assuré !
> Gagne des points !
> Rattrape ton retard !

Préférer :

> Contribution
> Dépenses
> Balance
> Activité
> À faire
> Ajouter
> Répartition
> Compensation
> 42 min d'écart
> CHF 36.20 à régler

Ton : **factuel, calme, presque comptable, mais humain.**

---

# 14. PRODUIT 100 % GRATUIT

Supprimer de l'UX :

- `/premium` ;
- paywalls ;
- upsells ;
- plan badges ;
- cadenas ;
- limites d'historique ;
- limite de groupes ;
- restriction To-do ;
- pondération Premium ;
- archive Premium ;
- pricing.

Ne pas afficher un faux modèle économique.

Les éventuelles abstractions Billing/Entitlement peuvent être retirées si devenues inutiles, ou temporairement conservées comme ports internes pendant la migration si leur suppression immédiate crée plus de risque qu'elle n'en retire.

Mais elles ne doivent plus influencer le comportement produit final.

---

# 15. DATA PRODUCT — PRÉSERVER L'EXISTANT, NE PAS LE REFAIRE

V2 possède déjà `src/analytics/` :

- consent policy ;
- taxonomy ;
- pipeline ;
- differential privacy ;
- query budget ;
- release gate ;
- buyer contracts ;
- audit log.

et une doctrine détaillée dans `docs/DATA_PRODUCT_PRIVACY.md`.

CETTE ARCHITECTURE EST UN ACTIF À PRÉSERVER.

Ne pas la remplacer par Firebase Analytics brut, simple pseudonymisation, export CSV ou IDs hashés présentés comme « anonymes ».

## Nouveau principe

La saisie utilisateur reste libre.

On stocke dans l'Operational Store les données nécessaires au fonctionnement du produit, notamment le texte brut.

Exemples : `qspi salon`, `aspi`, `Vacuum downstairs`, `courses Migros`.

On ne force PAS la normalisation au moment de la saisie.

### Classification downstream

Étendre `TaskTaxonomyService` / pipeline existante afin qu'une future étape IA puisse transformer, dans un environnement contrôlé :

`qspi salon`

en données dérivées telles que :

- catégorie : cleaning/vacuuming ;
- zone éventuelle : living_room ;
- portée éventuelle : partial ;
- langue détectée ;
- confiance ;
- version du classifieur.

Le résultat normalisé peut alimenter le Research Analytics Store.

Le texte brut :

- reste dans l'environnement opérationnel/protégé autant que nécessaire ;
- n'est jamais livré à un acheteur ;
- n'est jamais inclus dans une release statistique externe.

La classification IA doit être :

- versionnée ;
- reproductible ;
- réexécutable ultérieurement sur l'historique autorisé ;
- découplée du domaine métier.

---

# 16. NOUVEAUX ÉVÉNEMENTS ANALYTIQUES

Étendre le schéma analytics existant afin de pouvoir dériver proprement, selon consentement/finalité applicable :

### Contributions

- type d'événement ;
- catégorie normalisée downstream ;
- unité `minutes | points` ;
- valeur ;
- nombre de bénéficiaires ;
- taille du groupe ;
- récurrence ;
- timestamp généralisable ;
- contexte groupe ;
- réalisation planifiée ou spontanée.

### Dépenses

- montant ;
- devise ;
- catégorie normalisée si disponible ;
- nombre de participants ;
- mode de répartition ;
- timestamp ;
- taille du groupe.

### Compensation

- ledger source ;
- ledger cible ;
- taux choisi par le groupe ;
- valeur compensée ;
- unité de contribution.

### Usage produit

- création de groupe ;
- invitation ;
- membre rejoint ;
- utilisation contribution ;
- utilisation dépenses ;
- utilisation conjointe des deux ;
- activation compensation ;
- rétention/cohortes sous forme compatible avec la doctrine privacy.

NE PAS exporter de :

- userId opérationnel ;
- householdId/groupId opérationnel ;
- email ;
- nom ;
- appareil ;
- advertising ID ;
- texte libre ;
- historique individuel ré-identifiable.

Continuer à utiliser :

- cohort minimum ;
- rare-cell suppression ;
- privacy gate ;
- query budget ;
- protections anti-reconstruction ;
- differential privacy quand pertinente.

---

# 17. CONSENTEMENT ET TRANSPARENCE

La V3 gratuite ne doit jamais cacher son modèle de données.

Dans les Options personnelles, conserver une section claire **Données & recherche**.

Elle doit permettre :

- consultation de l'information ;
- préférence/consentement selon juridiction/finalité ;
- retrait lorsque applicable ;
- distinction claire entre données indispensables au fonctionnement et contribution au produit statistique.

Ne jamais employer « Vos données sont anonymes » lorsqu'elles sont encore dans l'Operational Store.

Respecter la distinction existante V2 :

- opérationnel = données personnelles/pseudonymisées protégées ;
- produit externe = agrégats réellement anonymisés après pipeline.

---

# 18. DONNÉES EN MINUTES VS POINTS

Le produit doit accepter les deux.

Cependant les données analytiques doivent conserver explicitement `contributionUnit = minutes | points`.

Ne jamais mélanger statistiquement les points de groupes différents comme s'ils étaient comparables.

Les minutes peuvent produire des statistiques inter-groupes plus facilement.

Les points restent une préférence produit utile mais doivent être traités comme une métrique locale au groupe sauf transformation scientifiquement justifiée.

Aucun changement d'unité ne doit silencieusement réinterpréter l'historique.

Si un groupe passe Points -> Minutes ou Minutes -> Points :

- conserver la provenance/unité de chaque écriture historique ;
- demander si nécessaire une conversion définie explicitement par le groupe ;
- ne jamais inventer un taux.

---

# 19. MATHÉMATIQUES ET INTÉGRITÉ

Toute écriture doit être déterministe et testable.

Invariants :

### Contribution

Somme des balances = 0.

### Argent

Somme des balances = 0, à l'arrondi monétaire près traité explicitement.

### Compensation croisée

Chaque opération doit préserver l'intégrité des deux ledgers et être traçable.

### Modification / suppression

Rejouer ou inverser proprement l'effet de l'écriture.

Aucun solde ne doit dépendre d'un champ UI dérivé.

Le ledger est la source de vérité.

Ajouter des property/invariant tests pour ces règles.

---

# 20. MIGRATION TECHNIQUE

Ne pas tout réécrire.

Conserver autant que possible :

- Expo / React Native ;
- Expo Router ;
- `AppContext` ou son évolution ;
- ports/adapters ;
- repositories ;
- tenant isolation ;
- invitation abstraction ;
- secure storage abstraction ;
- sync abstraction ;
- notification/calendar/share abstractions ;
- `PersistentTask` ;
- `TodoItem` ;
- historique transactionnel ;
- architecture analytics ;
- test harness ;
- Maestro/E2E ;
- factory Builder/Auditor/Director.

Faire évoluer :

- `CompletedEntry` vers un modèle de ContributionEntry suffisamment générique ;
- ajouter `ExpenseEntry` ;
- ajouter `CrossLedgerSettlement` ;
- ajouter configuration d'unité du groupe ;
- ajouter conversion optionnelle ;
- remplacer `ScoreResult` par une représentation plus générale des balances sans casser brutalement les appels avant migration ;
- étendre repositories/use-cases.

Supprimer :

- chrono ;
- premium UX ;
- paywalls ;
- restrictions d'entitlements ;
- subscription copy ;
- archive gating.

Ne pas introduire Firebase ou un backend spécifique directement dans le domaine.

Respecter les frontières existantes.

---

# 21. STRATÉGIE DE MIGRATION OBLIGATOIRE

Avant d'écrire du code :

1. auditer les objets V2 ;
2. dresser une carte `V2 -> V3` ;
3. identifier ce qui reste inchangé ;
4. identifier ce qui est étendu ;
5. identifier ce qui doit disparaître ;
6. créer les nouveaux invariants métier ;
7. écrire/adapter les tests ;
8. seulement ensuite modifier l'implémentation.

Le Builder ne doit jamais massacrer une fonctionnalité V2 fonctionnelle pour aller plus vite.

La migration doit avancer par tranches verticales testables.

Ordre recommandé :

### V3-01 — Domaine

- contribution generic unit ;
- expense ledger ;
- settlement ;
- invariants.

### V3-02 — Migration UI structure

- nouveau theme ;
- suppression Premium visible ;
- root groupes ;
- 3 tabs `Ajouter | Balances | À faire`.

### V3-03 — Ajouter

- switch Contribution/Dépense ;
- contribution sans chrono ;
- expense entry ;
- historique unifié.

### V3-04 — Balances

- double ledger ;
- périodes ;
- filtres ;
- settlements ;
- historique filtré.

### V3-05 — À faire

- adaptation unités ;
- complétion atomique.

### V3-06 — Invitations / multi-groupes

- vrai parcours complet ;
- share/deep-link honnête selon infra.

### V3-07 — Data product

- adaptation des événements ;
- classification-ready raw operational data ;
- privacy pipeline étendue ;
- consentement.

### V3-08 — Finition

- accessibilité ;
- localisation ;
- offline ;
- errors/empty states ;
- Android APK ;
- iOS readiness ;
- E2E ;
- visual audit.

---

# 22. QUALITÉ VISUELLE : NE PAS ACCEPTER « FONCTIONNEL »

La V2 avait déjà comme règle : un écran fonctionnel mais visuellement générique/provisoire n'est pas fini.

Cette règle devient encore plus importante en V3.

Rejeter le candidat si :

- il ressemble à un template Expo ;
- il ressemble à une chore app enfant ;
- il ressemble à un dashboard SaaS web ;
- le gris métallique devient un gradient kitsch ;
- trop de cartes ;
- trop de pills ;
- trop d'icônes ;
- les nombres importants ne dominent pas correctement ;
- les balances rouge/vert deviennent agressives ;
- les formulaires deviennent plus longs que V2 ;
- le passage Contribution/Dépense donne l'impression de deux apps collées ;
- l'historique perd sa densité transactionnelle ;
- l'app explique trop au lieu de montrer.

Le résultat doit sembler : **simple parce qu'il est maîtrisé, pas simple parce qu'il est incomplet.**

---

# 23. ÉTATS OBLIGATOIRES

Concevoir et tester explicitement :

- aucun groupe ;
- groupe sans activité ;
- contribution seulement ;
- dépenses seulement ;
- groupe utilisant les deux ;
- balance parfaitement à zéro ;
- balance contribution positive/négative ;
- balance argent positive/négative ;
- compensation désactivée ;
- compensation activée ;
- plusieurs devises si architecture retenue ;
- groupe nombreux ;
- invitation en attente ;
- offline ;
- erreur de persistence ;
- gros texte/accessibilité ;
- intitulé de tâche très long ;
- saisie avec faute/texte libre ;
- changement Points/Minutes ;
- historique très long ;
- suppression/modification d'une ancienne écriture.

---

# 24. CRITÈRES DE SUCCÈS V3

La V3 n'est terminée que si un nouvel utilisateur peut :

1. créer un groupe ;
2. inviter quelqu'un ;
3. choisir Points ou Minutes ;
4. ajouter une contribution ;
5. voir immédiatement la balance de contribution ;
6. ajouter une dépense ;
7. voir immédiatement la balance financière ;
8. utiliser les deux indépendamment ;
9. activer facultativement un taux de compensation ;
10. effectuer une compensation ;
11. retrouver toutes les opérations dans un historique clair ;
12. planifier puis compléter une tâche ;
13. modifier/supprimer correctement une opération ;
14. naviguer sans rencontrer de paywall ;
15. utiliser une interface cohérente, premium et adulte ;
16. disposer d'une architecture analytics qui collecte seulement ce qui est autorisé et peut produire ultérieurement des données anonymisées sans contaminer le domaine opérationnel.

Le golden path Android doit être compilé, installé et réellement traversé.

La readiness iOS doit être vérifiée.

Les tests existants utiles doivent être préservés/adaptés ; aucune suite verte obtenue en supprimant arbitrairement les assertions gênantes n'est acceptable.

---

# 25. RÈGLE FINALE

La V3 ne doit PAS devenir :

> « ChoreScore V2 avec une page dépenses ajoutée. »

Elle doit devenir :

> **un ledger partagé de ce qu'un groupe paie et de ce qu'il fait.**

Mais elle doit garder ce que la V2 avait déjà correctement compris :

- navigation courte ;
- saisie rapide ;
- fait par / fait pour ;
- historique transactionnel ;
- balances zéro-somme ;
- planning distinct du passé ;
- interface mobile dense mais respirante ;
- architecture métier séparée des fournisseurs ;
- confidentialité structurée dès le socle.

Le changement doit être profond dans la thèse produit, mais discipliné dans l'architecture.

**Ne pas repartir de zéro. Ne pas ajouter pour ajouter. Transformer.**
