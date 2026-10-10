# ChoreScore V4 — Release engineering et leçons V3

Ce document est canonique pour la factory/finalizer V4. Il existe pour empêcher la répétition des blocages V3.

## 1. Séparer produit et infrastructure
Un échec de runner, ADB, SystemUI, émulateur ou service Android n'est jamais automatiquement traité comme un bug produit. Les logs doivent distinguer explicitement :
- product/test failure ;
- emulator/ADB infrastructure failure ;
- build failure ;
- authentication/configuration failure.

Le repair suivant cible seulement la classe réellement prouvée.

## 2. APK disponible et validation ordonnée
Ordre de finalisation :
1. checks produit/privacy/coût/i18n ;
2. Expo export Android + iOS ;
3. prebuild Android ;
4. build release x86_64 pour l'émulateur ;
5. attendre Android réellement prêt ;
6. installer et exécuter golden path API 35 ;
7. seulement après E2E vert, build release arm64-v8a final ;
8. SHA-256 ;
9. upload artifact ;
10. attestation V4 complete.

Ne pas compiler quatre architectures avant de savoir si l'E2E passe.

## 3. Android réellement prêt
`sys.boot_completed=1` n'est pas suffisant.

Avant install/launch, attendre explicitement :
- ADB state=device ;
- `service check package` found ;
- `service check activity` found.

Après tout restart ADB, refaire cette gate.

## 4. Safe areas et taps
Ne jamais cliquer un simple label situé dans/près de la barre système Android. Les tests d'onglets cliquent le node clickable du tab control/content-desc. Les écrans doivent respecter safe-area/insets.

## 5. ANR
- Une ANR SystemUI est une panne d'environnement : elle peut être dismissée/retry de façon bornée.
- Une ANR ChoreScore est un finding produit sauf preuve forte de cold-start runner extrême.
- Ne jamais masquer les ANR applicatives de manière générale.

## 6. Auth E2E
Le finalizer ne dépend d'aucun secret Google/Apple/Facebook.

Le build E2E utilise une session locale déterministe activée uniquement par configuration de test. Le build normal ne montre ni bouton Démo ni email/password.

## 7. Boucles autonomes
- Un candidat repair cohérent est conservé.
- Une erreur finalizer rouvre uniquement V4-09 avec le log exact.
- La factory ne repart jamais sur V4-01 après un échec tardif.
- Quand `pendingArtifact=V4-09-RELEASE`, la factory produit s'arrête et seul le finalizer travaille.
- Une seule exécution finalizer active à la fois.
- Les retries infra sont bornés ; une répétition identique sans nouvelle preuve doit changer de stratégie, pas seulement augmenter les timeouts.

## 8. Artifacts et diagnostics
- Sur succès : upload `chorescore-v4-android-release`.
- Sur échec : upload diagnostics E2E + APK x86_64 si disponible.
- Les logs doivent imprimer la dernière étape produit atteinte.
- Le final artifact final doit rester téléchargeable au moins 30 jours.

## 9. Golden path V4 minimum
Le test réel doit démontrer :
- session E2E injectée sans écran Démo ;
- arrivée directe Groupes ;
- création groupe avec au moins deux membres nommés ;
- création catégorie libre ;
- ajout Tâche avec split custom ;
- ajout Dépense avec split custom ;
- note et photo test/fixture ou attachment stub honnête ;
- Balances affiche les deux ledgers ;
- modification d'une entrée depuis Balances ;
- partage déclenchable via adapter natif/mock E2E ;
- ajout d'un membre après création ;
- création et complétion d'un À faire Tâche ;
- création et complétion d'un À faire Dépense ;
- bascule FR/EN et retour FR ;
- vérification des trois tabs et safe area ;
- aucune occurrence UI de Contribution, Demo, Premium, Standard, Pro, abonnement ou paywall.

## 10. Performance
Le golden path n'autorise pas un full-history cloud reload à chaque écran. Les gates coût V3 restent obligatoires et sont étendues aux catégories, membres, photos et todo-expense.

## 11. Budget CI et tokens

`docs/CI_EFFICIENCY_POLICY.md` est contraignant. Un échec tardif reprend au point de panne le plus proche. Harness/infra utilisent la fast lane et réutilisent l'APK ; aucun Builder/Auditor/Director complet ni build/export lourd n'est autorisé sans invalidation réelle de la preuve correspondante. Les transitions d'état déterministes sont faites par shell, pas par LLM.
