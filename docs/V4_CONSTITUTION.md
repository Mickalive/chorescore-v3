# ChoreScore V4 — Constitution canonique

## 0. Principe produit

ChoreScore V4 est l'application gratuite qui permet à un groupe d'équilibrer, dans un seul endroit, **ce que ses membres paient et ce qu'ils font**.

V4 part de la V3 RC validée et la fait évoluer. Elle ne reconstruit pas les fondations qui fonctionnent déjà. Elle conserve notamment le double ledger, les invariants comptables, le local-first, la sync delta-only, les protections privacy/data product, les tests de coût et l'architecture ports/adapters.

L'application reste 100 % gratuite : aucun abonnement, plan Premium, paywall, limite artificielle de groupes, archive payante ou upsell.

## 1. Direction visuelle

V4 revient à la chaleur visuelle de V2, mais avec une exécution plus mature et plus soignée.

Palette canonique V2 à reprendre :
- primary: `#C0512F` — terracotta chaud
- primaryLight: `#F2CC8F` — ambre clair
- primaryDark: `#9A3A1B`
- background: `#FFF8F0`
- splash/adaptive background compatible: `#FFF5EB`
- surface: `#FFFFFF`
- surfaceAlt: `#FFF0E6`
- surfaceHighlight: `#FFE8D6`
- text: `#3D405B`
- textSecondary: `#5A7260`
- textMuted: `#606070`
- success: `#5D8C6F`
- error: `#C0512F`
- warning: `#7A5614`
- info: `#3D85C6`
- border: `#E8E0D8`
- divider: `#F0E8E0`

La palette chaude n'autorise pas une UI enfantine. Le résultat doit être beau, contemporain, accueillant, lisible, cohérent, avec hiérarchie typographique, espaces maîtrisés, états de pression, vides, erreurs, chargements et grands textes correctement traités.

Éviter : écrans génériques, empilements de cartes inutiles, pills décoratives, gradients gratuits, gamification, badges de compétition, crypto/neobank flashy.

## 2. Langues et qualité du texte

V4 est disponible en **français et anglais**.

- Tous les textes utilisateurs passent par une couche i18n ; aucun texte d'interface important ne doit rester hardcodé dans un composant.
- Le français utilise les accents, apostrophes et formulations correctes : `À faire`, `Dépenses`, `Activité`, `Équilibrer`, etc.
- La langue est modifiable dans **Options générales**, accessibles en bas de l'écran Groupes.
- Le choix est persisté localement.
- Les tests doivent détecter les clés manquantes et les chaînes visibles non traduites sur les parcours principaux.

## 3. Authentification et démarrage

### Produit normal
Le premier écran d'un utilisateur non authentifié propose directement les connexions sociales usuelles. Il n'affiche **ni mode démo, ni formulaire email/mot de passe**.

Providers visés par l'architecture :
- Google
- Apple
- Facebook

Les providers doivent rester derrière `AuthGateway`/adapters. Aucun faux OAuth n'est présenté comme réel.

Une session valide est persistée de manière sûre. Après la première authentification, un lancement ultérieur doit aller directement à **Groupes** sans repasser par l'écran de connexion.

### Build de test/finalizer
Les tests et l'APK de validation automatisée ne doivent pas dépendre de secrets OAuth externes. Un mode E2E local, déterministe et non visible dans un build normal peut injecter une session de test. Ce mode ne doit jamais apparaître comme bouton "Démo" dans l'interface normale.

## 4. Écran Groupes

L'écran Groupes est la racine après authentification.

Chaque groupe montre au minimum :
- nom du groupe ;
- nombre de membres ;
- accès au groupe ;
- bouton **Options**.

Il n'y a **pas de bouton Inviter sur la liste des groupes**.

En bas de l'écran Groupes se trouve l'accès **Options générales**.

Groupes illimités. Aucun plan, badge de prix ou restriction de groupe.

## 5. Création et gestion d'un groupe

À la création d'un groupe, l'utilisateur doit pouvoir saisir :
- nom du groupe ;
- unité de tâches : Minutes ou Points ;
- les noms des personnes du groupe, dès la création.

L'ajout de membres se fait par noms libres, sous forme de liste/chips/lignes éditables avec ajout/suppression claire avant validation.

Après création :
- les membres restent éditables ;
- de nouveaux membres peuvent être ajoutés plus tard ;
- les membres existants peuvent être renommés dans les limites compatibles avec l'historique/audit ;
- les identités liées à de vrais comptes et les simples membres nommés doivent être distinguées proprement dans le domaine.

### Invitations
Une invitation réelle est créée **après** l'existence du groupe, depuis les options du groupe ou la gestion des membres.

- lien d'invitation stable/expirable selon le modèle retenu ;
- partage via la share sheet native du système ;
- acceptation/deep-link lorsque l'intégration est disponible ;
- pas de bouton Inviter sur la carte du groupe.

## 6. Navigation interne du groupe

Les trois onglets restent :
1. **Ajouter**
2. **Balances**
3. **À faire**

Ils doivent respecter les safe areas Android/iOS et rester réellement cliquables sans chevaucher les barres système.

## 7. Ajouter — Tâches et Dépenses

Le mot **Contribution** disparaît de l'interface. Il devient **Tâche** en français et **Task** en anglais. Les noms techniques internes peuvent être migrés progressivement seulement si cela n'introduit pas de risque, mais aucune UI finale ne doit parler de Contribution.

L'onglet Ajouter contient un switch :
- **Tâche**
- **Dépense**

Il n'affiche plus l'historique éditable des activités. La modification/suppression des écritures est déplacée dans Balances.

### 7.1 Tâche
Une tâche permet :
- titre libre ;
- catégorie facultative ;
- fait par ;
- fait pour / bénéficiaires ;
- valeur en Minutes ou Points selon le groupe ;
- répartition égale ou personnalisée entre bénéficiaires ;
- application facultative du ratio par défaut de la catégorie ;
- date/heure ;
- note facultative ;
- photo facultative ;
- partage via share sheet native.

Pas de chrono.

Le ledger conserve l'invariant somme nulle : le performer reçoit la valeur positive, la charge est répartie entre bénéficiaires selon les poids choisis. L'auto-part annule sa fraction.

### 7.2 Dépense
Une dépense permet :
- titre libre ;
- catégorie facultative ;
- montant en unités monétaires mineures entières ;
- devise ;
- payé par ;
- payé pour / bénéficiaires ;
- répartition égale ou personnalisée ;
- date/heure ;
- note facultative ;
- photo facultative ;
- partage via share sheet native.

Ledger argent à somme exactement nulle par devise. Aucune conversion de devise silencieuse.

### 7.3 Membres dans Ajouter
Dans l'onglet Ajouter, à l'endroit occupé auparavant par l'historique des activités, afficher une entrée/section **Membres** permettant :
- voir les membres du groupe ;
- ajouter un membre par nom ;
- accéder au lien d'invitation/partage quand pertinent.

Cette gestion ne doit pas encombrer le formulaire principal.

## 8. Catégories libres

Aucune catégorie métier n'est imposée ou seedée. En particulier, "Vaisselle" n'est pas une catégorie obligatoire ou unique.

L'utilisateur peut :
- créer ses propres catégories ;
- renommer/supprimer une catégorie sans corrompre l'historique ;
- laisser une écriture sans catégorie ;
- choisir une catégorie existante lors de l'ajout.

Un bouton **Gérer les catégories / Manage categories** se trouve juste sous l'action principale d'ajout Tâche/Dépense.

### Ratio par défaut
Pour une catégorie de tâche, le groupe peut définir un ratio de répartition par défaut entre membres (poids relatifs). Ce ratio :
- est un défaut UX, jamais une réécriture historique ;
- peut être remplacé par une répartition personnalisée sur une tâche précise ;
- est snapshoté/normalisé sur l'écriture finale afin que l'historique reste stable.

## 9. Notes et photos

Chaque Tâche et Dépense peut avoir :
- une note libre facultative ;
- une photo facultative.

Les pièces jointes sont opérationnelles et privées. Elles ne sont jamais exportées dans le Research Analytics Plane. Les métadonnées minimales nécessaires à la sync peuvent être stockées ; aucun traitement IA de photo n'est requis pour V4.

La suppression/édition doit traiter les références de pièces jointes sans orphaning silencieux.

## 10. Balances

Balances devient l'endroit où l'on consulte, filtre et modifie l'historique.

Il affiche distinctement :
- balances **Tâches** ;
- balances **Dépenses** par devise ;
- compensation inter-ledgers seulement si activée explicitement par le groupe ;
- historique paginé.

Chaque Tâche/Dépense historique peut être :
- ouverte ;
- modifiée ;
- supprimée via replay/tombstone ;
- partagée via la share sheet native.

Les vues semaine/mois/année restent des filtres ; la balance principale est perpétuelle.

## 11. À faire

Un élément À faire peut être de type :
- **Tâche**
- **Dépense**

Création commune : titre, type, assignation, bénéficiaires, échéance, rappel si disponible, note, catégorie facultative.

À la complétion :
- un À faire de type Tâche demande/confirme performer, valeur, bénéficiaires/répartition, note/photo éventuelle, puis crée exactement une Task/ContributionEntry ;
- un À faire de type Dépense demande/confirme payeur, montant/devise, bénéficiaires/répartition, note/photo éventuelle, puis crée exactement une ExpenseEntry ;
- la complétion et le marquage du todo sont atomiques et offline-safe.

## 12. Partage

Tout partage utilisateur utilise le **share sheet natif** afin que l'utilisateur choisisse librement WhatsApp, Messages, Mail, Signal, Telegram, etc. selon ce qui est installé.

Cas minimum :
- lien d'invitation ;
- résumé d'une Tâche ;
- résumé d'une Dépense.

Ne jamais coder une liste fermée de réseaux sociaux.

## 13. Options générales

Accessibles en bas de Groupes.

Sections minimales, inspirées de V2 mais nettoyées du freemium :
- Profil
- Langue : Français / English
- Notifications
- Confidentialité / consentement data
- Apparence si utile
- Légal : Conditions d'utilisation, Politique de confidentialité, Mentions légales
- Se déconnecter

Aucune section abonnement, Premium, facturation ou démo.

## 14. Options du groupe

Le bouton Options sur chaque groupe est conservé.

Il permet notamment :
- nom du groupe ;
- unité Minutes/Points ;
- devise(s) utilisées ;
- compensation tâches/argent et taux explicite si activée ;
- membres ;
- invitations ;
- catégories et ratios par défaut ;
- suppression du groupe avec confirmation forte.

## 15. Architecture et coûts

Conserver les règles V3 :
**Write once. Sync deltas. Read local. Derive incrementally. Classify once. Aggregate later.**

- UI local-first ;
- stockage métier indexé, SQLite privilégié ;
- sync delta-only par groupe avec cursor/révision/tombstone ;
- aucun full scan ou N+1 sur actions normales ;
- balances matérialisées reconstruisibles ;
- historique paginé/cache ;
- mutations optimistes locales ;
- conflits comptables déterministes/auditables ;
- Firebase/Firestore uniquement derrière adapters ;
- aucune logique comptable dans React.

Les photos ne doivent pas provoquer de téléchargement massif à l'ouverture d'un historique : métadonnées/lazy loading.

## 16. Privacy / data product

Préserver le pipeline V3/V2 :
Operational Event → Semantic Classification → Privacy Transform → Research Fact → Aggregation → Privacy Release Gate.

Ne jamais exporter :
- noms ou emails ;
- IDs utilisateurs/groupes ;
- device/ad IDs ;
- texte libre ;
- notes ;
- photos ;
- URLs privées ;
- historique individuellement ré-identifiable.

Les catégories libres peuvent être normalisées downstream seulement après privacy transform appropriée. Les libellés bruts ne sortent pas.

## 17. États obligatoires V4

Tester au minimum :
- non authentifié ;
- session persistée ;
- aucun groupe ;
- groupe vide ;
- création groupe avec 1, 2, plusieurs membres nommés ;
- ajout membre après création ;
- lien d'invitation ;
- tâche seule ;
- dépense seule ;
- tâches + dépenses ;
- catégorie absente ;
- création catégorie libre ;
- ratio catégorie par défaut ;
- override custom d'une tâche ;
- note seule ;
- photo seule ;
- note + photo ;
- modification/suppression depuis Balances ;
- partage tâche/dépense ;
- todo tâche ;
- todo dépense ;
- compensation off/on ;
- multi-devise sans conversion implicite ;
- changement d'unité sans réinterprétation historique ;
- offline ;
- erreur de persistance ;
- énorme historique ;
- grand texte/accessibilité ;
- français ;
- anglais ;
- accents français ;
- safe areas Android/iOS.

## 18. Définition de fini

V4 n'est finie que lorsque :
- tous les critères V4 sont audit-acceptés ;
- typecheck/tests/privacy/cost sont verts ;
- Android et iOS exportent ;
- un APK release arm64-v8a est construit ;
- un APK x86_64 de validation est installé sur Android API 35 ;
- le golden path V4 réel passe sans Metro ;
- l'APK final est hashé et uploadé comme artifact ;
- le statut V4 est `complete`, aucun finding ouvert, Builder désactivé.

### Invitation et rattachement des membres nommés

- Un membre nommé créé avec le foyer ou ajouté ensuite est une identité de ledger persistante, même avant d'avoir un compte.
- Les options du groupe doivent permettre d'inviter ce membre nommé via un lien partagé par la feuille de partage native.
- L'invitation ciblée conserve l'identité du membre nommé (memberId). À l'acceptation, le compte authentifié est rattaché à CE membre existant en renseignant son userId ; aucun second membre ne doit être créé.
- Toutes les tâches, dépenses, todos et balances historiques déjà rattachés à ce memberId restent inchangés et deviennent naturellement ceux du compte lié.
- Une invitation ne doit jamais fusionner deux membres distincts par simple égalité de nom. Le rattachement se fait par l'identifiant ciblé porté par l'invitation.
- L'APK V4 ne peut pas être finalisé tant que le parcours « créer foyer avec membre nommé → inviter ce membre → accepter → même membre lié sans doublon » n'est pas testé.
