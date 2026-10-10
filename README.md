# Mon Planning — CSA

Application **Mon Planning** du **Cours Secondaire Ambourhouet (CSA)**.

## Version
V4 validée — migration GitHub effectuée.

## Fonctions
- Direction
- Professeurs
- Mes classes
- Élèves
- Parents
- Emplois du temps Aujourd’hui / Semaine
- Présence école : À confirmer / Présent / Absent
- Connexion application : Hors ligne / Connecté
- En cours / Libre selon l’emploi du temps
- Absences et remplacements
- Réinitialisation de la démo

## Données intégrées
- 36 classes
- 65 professeurs
- 16 matières
- Emplois du temps 2026 fournis pour le CSA

## Accès démo
- Code Direction : `6200`
- Codes professeurs : `6201` à `6265`

## V5 — suivi des élèves
- 4 profils visibles : Direction, Professeur, Élève, Parent
- Appel de classe par tranche horaire
- 10 élèves de démonstration par classe
- Présents / Absents / heure de l’appel
- Reprise automatique de l’appel sur une 2e heure consécutive, avec mise à jour possible
- Vue Parent : statut de son enfant par cours
- Vue Direction : synthèse des présences élèves
- Synchronisation Firebase Realtime Database
- Logo CSA bleu clair validé

## Étape suivante
Connexion Firebase Realtime Database pour synchroniser les statuts, absences et remplacements entre plusieurs appareils.
