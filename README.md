# ChoreScore — Android

Application locale de répartition des tâches et des dépenses : groupes, membres, tâches, dépenses, soldes.

**Mode actuel : utilisation sur un seul téléphone, hors ligne.** Le démarrage ne requiert aucun compte Google/Apple/Facebook ; les données sont conservées localement avec SQLite. La synchronisation entre plusieurs téléphones, les photos et les connexions sociales ne sont pas disponibles dans cette version.

## Obtenir l'APK

1. Ouvrir l'onglet **Actions** puis le workflow **Android APK** sur la branche `main`.
2. Cliquer sur le dernier lancement réussi, puis télécharger l'artifact **ChoreScore-Android-APK**.
3. Extraire `ChoreScore-Android.apk` du ZIP et l'installer sur un téléphone Android ARM64 (autoriser l'installation depuis ce navigateur ou gestionnaire de fichiers si demandé).

**Une seule chaîne de construction** : `.github/workflows/android-apk.yml` ; elle compile l'APK et l'archive. Un APK compilé ne constitue pas à lui seul une validation complète de chaque parcours sur téléphone.

Le binaire est signé avec la clé Android de développement pour un test manuel ; ce n'est **pas** une version Play Store.
