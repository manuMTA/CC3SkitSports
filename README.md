# Suivi Triathlon : mise en ligne

Site web où chaque adhérent crée un compte, avec son e-mail ou avec Strava, puis suit ses statistiques de natation, de vélo et de course. Une page d'administration permet au coach de gérer les comptes et de consulter les séances.

**Ce qu'il faut :** un compte GitHub, un compte Vercel et un compte Supabase, tous gratuits. **Strava est facultatif** : sans lui, les adhérents saisissent leurs séances ou importent un fichier.

## Ce que fait l'application

| Fonction | Sans Strava | Avec Strava |
|---|---|---|
| Créer un compte | E-mail + mot de passe | Bouton « Se connecter avec Strava » (ou lier Strava à un compte e-mail) |
| Alimenter les statistiques | Saisie d'une séance ; import d'un fichier CSV (export Strava, export Garmin Connect, tableur) | Récupération automatique des activités |
| Vue coach (page Administration) | Voit les séances saisies et importées de chaque adhérent | Les activités synchronisées depuis Strava restent privées (règles de Strava) |
| Mot de passe oublié | Le coach génère un mot de passe provisoire depuis l'administration | — |

---

## Étape 1 : la base de données (Supabase)

1. Créez un projet sur https://supabase.com (région Europe, par exemple Paris).
2. Ouvrez **SQL Editor**, collez le contenu du fichier `schema.sql`, puis cliquez sur **Run**. Le script supprime d'abord les tables de l'ancienne version, si vous les aviez créées.
3. Notez :
   - l'**URL du projet** (`https://xxxx.supabase.co`) : c'est `SUPABASE_URL` ;
   - dans **Project Settings › API Keys**, la **clé secrète** (`sb_secret_…`) : c'est `SUPABASE_SERVICE_ROLE_KEY`. Sur un ancien projet, la clé `service_role` fonctionne aussi. Cette clé est secrète : ne la mettez jamais dans une page web.

## Étape 2 : mettre le code sur GitHub puis sur Vercel

1. Créez un dépôt GitHub et déposez-y tout le **contenu** de ce dossier.
2. Sur https://vercel.com, cliquez sur **Add New › Project**, importez le dépôt et laissez le *Framework Preset* sur **Other**.
3. Dans **Environment Variables**, ajoutez :

| Variable | Valeur |
|---|---|
| `APP_URL` | L'adresse du site, sans `/` final, par exemple `https://suivi-triathlon.vercel.app` |
| `SUPABASE_URL` | Voir l'étape 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Voir l'étape 1 |
| `SESSION_SECRET` | Une longue chaîne aléatoire, par exemple 64 caractères tapés au hasard (lettres et chiffres) |
| `ADMIN_EMAILS` | **Votre adresse e-mail**, celle avec laquelle vous créerez votre compte sur le site. Ajoutez d'autres coachs en séparant les adresses par des virgules. |

4. Déployez. Ouvrez le site, cliquez sur **Créer un compte** avec l'adresse mise dans `ADMIN_EMAILS` : le menu en haut à droite affiche alors **Administration**.

À ce stade, le site fonctionne **sans Strava**.

## Étape 3 (facultative) : ajouter la connexion Strava

⚠️ Strava exige un **abonnement Strava payant pour le compte qui crée l'application**. Vos adhérents n'en ont pas besoin. Une nouvelle application est limitée à 1 athlète ; vous pouvez passer à 10 depuis le tableau de bord API Strava, et au-delà il faut une validation de Strava.

1. Sur https://www.strava.com/settings/api, créez une application :
   - **Website** : l'adresse du site ;
   - **Authorization Callback Domain** : le domaine seul, sans `https://` (par exemple `suivi-triathlon.vercel.app`).
2. Ajoutez dans Vercel `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` et `STRAVA_WEBHOOK_VERIFY_TOKEN` (un mot de passe de votre choix), puis redéployez (**Deployments › ⋯ › Redeploy**). Le bouton « Se connecter avec Strava » apparaît alors sur l'accueil.
3. Abonnez le site aux événements Strava. C'est exigé par Strava, et les nouvelles activités arrivent ensuite automatiquement. Lancez une fois, dans un terminal, sur une seule ligne :

```
curl -X POST https://www.strava.com/api/v3/push_subscriptions -F client_id=VOTRE_CLIENT_ID -F client_secret=VOTRE_CLIENT_SECRET -F callback_url=https://VOTRE-SITE/api/webhook -F verify_token=VOTRE_STRAVA_WEBHOOK_VERIFY_TOKEN
```

4. Règles de marque Strava : remplacez le bouton orange par le bouton officiel « Connect with Strava » (https://developers.strava.com/guidelines/).

---

## Bon à savoir

- **Confidentialité.** Chaque adhérent ne voit que ses propres séances. Le coach voit les séances saisies et importées, mais pas celles synchronisées depuis Strava : l'accord API Strava interdit de les montrer à quelqu'un d'autre. Un adhérent qui veut partager son historique Strava avec le coach peut importer son export Strava (fichier CSV).
- **Mots de passe.** Ils sont chiffrés (scrypt) : personne, pas même l'administrateur, ne peut les lire. En cas d'oubli, le coach génère un mot de passe provisoire (**Administration › Mot de passe**), puis l'adhérent le change depuis son menu.
- **Import de fichiers.** Les formats reconnus sont : `activities.csv` de l'export Strava, l'export CSV de Garmin Connect (site web), ou un tableur enregistré en CSV avec au moins les colonnes *Date*, *Sport*, *Distance* (km, ou m pour la natation) et *Durée* (hh:mm:ss). Réimporter le même fichier ne crée pas de doublons.
- **Limites de Vercel (offre gratuite).** L'application utilise 7 fonctions serveur, en dessous de la limite de 12.

## Organisation du code

```
public/index.html        Accueil (connexion / inscription) + tableau de bord de l'adhérent
public/admin.html        Administration : utilisateurs, groupes, vue coach, mots de passe
public/dashboard.js      Graphiques et statistiques
public/import.js         Lecture des fichiers CSV
public/style.css         Styles
api/auth/[action].js     Inscription, connexion e-mail, connexion et liaison Strava, déconnexion
api/account.js           Mot de passe, ajout d'e-mail, délier Strava, suppression du compte
api/activities.js        Saisie, import et suppression de séances
api/me.js                Données de l'utilisateur connecté
api/sync.js              Récupération des nouvelles activités Strava
api/admin.js             Fonctions administrateur
api/webhook.js           Événements Strava
schema.sql               Tables Supabase (users, activities)
```

Aucune dépendance npm : Vercel exécute directement les fichiers de `api/` (Node 18 ou plus récent).
