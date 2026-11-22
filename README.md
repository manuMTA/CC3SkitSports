# Suivi Triathlon : mise en ligne

Site web où chaque visiteur se connecte avec Strava et voit ses statistiques de natation, de vélo et de course. Une page d'administration liste les utilisateurs.

**Ce qu'il faut :** un compte GitHub, un compte Vercel et un compte Supabase (tous gratuits), plus votre compte Strava. Comptez environ 30 minutes.

---

## Étape 1 : la base de données (Supabase)

1. Créez un projet sur https://supabase.com (région Europe, par exemple Paris ou Francfort).
2. Ouvrez **SQL Editor**, collez le contenu du fichier `schema.sql`, puis cliquez sur **Run**.
3. Notez :
   - l'**URL du projet** (`https://xxxx.supabase.co`) : c'est `SUPABASE_URL` ;
   - dans **Project Settings › API Keys**, la **clé secrète** (`sb_secret_…`) : c'est `SUPABASE_SERVICE_ROLE_KEY`. Sur un ancien projet, la clé `service_role` fonctionne aussi. Cette clé est secrète : ne la mettez jamais dans une page web.

## Étape 2 : mettre le code sur GitHub puis sur Vercel

1. Créez un dépôt GitHub et déposez-y tout le contenu de ce dossier.
2. Sur https://vercel.com, cliquez sur **Add New › Project**, importez le dépôt et laissez le *Framework Preset* sur **Other**.
3. Avant de cliquer sur **Deploy**, ouvrez **Environment Variables** et ajoutez les variables du fichier `.env.example` (vous compléterez celles de Strava à l'étape 3) :

| Variable | Valeur |
|---|---|
| `APP_URL` | L'adresse du site, sans `/` final, par exemple `https://suivi-triathlon.vercel.app` |
| `SUPABASE_URL` | Voir l'étape 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Voir l'étape 1 |
| `SESSION_SECRET` | Une longue chaîne aléatoire (commande dans `.env.example`) |
| `ADMIN_STRAVA_IDS` | Votre identifiant Strava : le nombre à la fin de l'adresse de votre profil, `strava.com/athletes/12345678`. Mettez plusieurs identifiants séparés par des virgules s'il y a plusieurs administrateurs. |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Voir l'étape 3 |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Un mot de passe de votre choix |

4. Déployez. Notez l'adresse du site et vérifiez que `APP_URL` correspond exactement.

## Étape 3 : l'application Strava

1. Allez sur https://www.strava.com/settings/api et créez une application :
   - **Website** : l'adresse du site ;
   - **Authorization Callback Domain** : le domaine seul, sans `https://` (par exemple `suivi-triathlon.vercel.app`).
2. Copiez le **Client ID** et le **Client Secret** dans les variables Vercel, puis redéployez (**Deployments › ⋯ › Redeploy**).
3. Abonnez le site aux événements Strava. Strava les exige, notamment pour supprimer les données d'un athlète qui retire son autorisation. Lancez une fois cette commande dans un terminal, en remplaçant les valeurs :

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=VOTRE_CLIENT_ID \
  -F client_secret=VOTRE_CLIENT_SECRET \
  -F callback_url=https://VOTRE-SITE/api/webhook \
  -F verify_token=VOTRE_STRAVA_WEBHOOK_VERIFY_TOKEN
```

La réponse doit contenir un `id`. Ensuite, chaque nouvelle activité arrive toute seule, sans clic sur « Synchroniser ».

## Étape 4 : tester

Ouvrez le site, cliquez sur **Se connecter avec Strava** et acceptez l'autorisation. Votre tableau de bord s'affiche. Le menu en haut à droite donne accès à **Administration**.

---

## ⚠️ Limites imposées par Strava (à lire avant de diffuser le lien)

- **Nombre d'athlètes.** Une nouvelle application Strava n'accepte qu'**un seul athlète** : vous. Depuis le tableau de bord API Strava, vous pouvez passer à **10 athlètes** sans examen (Strava peut demander un abonnement). **Au-delà de 10**, il faut demander un examen à Strava (formulaire lié dans https://developers.strava.com/docs/getting-started/). Les délais constatés vont de plusieurs semaines à plusieurs mois. Tant que la limite est atteinte, un nouvel utilisateur voit le message « nombre maximum d'athlètes atteint ».
- **Confidentialité.** L'accord API Strava interdit d'afficher les données d'un utilisateur à quelqu'un d'autre. L'administration montre donc les utilisateurs (nom, ville, groupe, dates), **pas leurs activités**.
- **Marque Strava.** Les règles de marque demandent d'utiliser le bouton officiel « Connect with Strava » et le logo « Powered by Strava » : https://developers.strava.com/guidelines/. Téléchargez ces images, placez-les dans `public/`, puis remplacez le bouton orange de `public/index.html`. Les liens « Voir sur Strava » sont déjà présents.
- **Quotas.** Par défaut : 200 requêtes par 15 minutes et 2 000 par jour pour toute l'application. La première synchro récupère les 600 activités les plus récentes. Chaque clic sur « Synchroniser » récupère jusqu'à 1 000 nouvelles activités.
- **Nouvelle adresse d'API.** Strava a annoncé `https://api-v3.strava.com` pour 2027. Le moment venu, il suffira d'ajouter la variable `STRAVA_API_BASE`.

## Organisation du code

```
public/index.html      Accueil + tableau de bord de l'utilisateur connecté
public/admin.html      Liste des utilisateurs (administrateurs)
public/dashboard.js    Graphiques et statistiques
public/style.css       Styles
api/auth/*             Connexion Strava (OAuth), déconnexion
api/me.js              Données de l'utilisateur connecté
api/sync.js            Récupération des nouvelles activités
api/account/delete.js  Suppression du compte par l'utilisateur
api/admin/users.js     Liste, groupes, retrait d'un utilisateur
api/webhook.js         Événements Strava
schema.sql             Tables Supabase
```

Aucune dépendance npm : Vercel exécute directement les fichiers de `api/` (Node 18 ou plus récent).
Pour travailler en local : `npm i -g vercel`, puis `vercel dev`, avec un fichier `.env` rempli à partir de `.env.example` et `APP_URL=http://localhost:3000`. Ajoutez aussi `localhost` comme *Callback Domain* dans Strava.
