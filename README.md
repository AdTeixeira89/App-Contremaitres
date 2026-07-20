# Suivi Contremaîtres

Prototype de l'application interne de suivi des postes non travaillables.

## Fonctionnalités présentes

- Collage d'un SMS reçu.
- Analyse automatique du numéro de poste, de la prestation, de l'équipe et du motif.
- Création d'une fiche modifiable.
- Attribution automatique au contremaître associé à l'équipe.
- Statuts : À traiter, En cours, En attente, Traité, Classé sans action.
- Historique des changements.
- Tableau de bord avec statistiques par motif et par équipe.
- Réglages modifiables pour les contremaîtres, équipes, prestations et motifs.
- Installation possible comme application web sur téléphone.

## Important

Cette première version est un prototype local : les données restent dans le navigateur de l'appareil.

La prochaine version ajoutera :

- base de données partagée ;
- comptes utilisateurs et droits ;
- notifications ;
- pièces jointes ;
- statistiques par commune ;
- synchronisation entre les quatre contremaîtres.

## Tester localement

Ouvrir `index.html` dans un navigateur, ou lancer un petit serveur local :

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

## Publier sur GitHub Pages

1. Créer un dépôt GitHub, par exemple `suivi-contremaitres`.
2. Envoyer tous les fichiers de ce dossier dans le dépôt.
3. Dans GitHub : **Settings > Pages**.
4. Choisir **Deploy from a branch**.
5. Sélectionner la branche `main` et le dossier `/root`.
6. Enregistrer.

L'application sera ensuite disponible à l'adresse GitHub Pages du dépôt.
