// =====================================================================
// Configuration de SuiviTri — à compléter (voir README, étapes 2 et 3)
// Ces valeurs sont publiques par nature : elles peuvent être sur GitHub.
// Ne mettez JAMAIS ici la clé secrète Supabase ni le « Client Secret » Strava.
// =====================================================================
window.SUIVITRI_CONFIG = {
  // Supabase > Project Settings > Data API : « Project URL »
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',

  // Supabase > Project Settings > API Keys : clé « Publishable » (commence par sb_publishable_)
  supabaseKey: 'sb_publishable_A_REMPLACER',

  // Strava > Paramètres > Mon application API : « Client ID » (un nombre)
  stravaClientId: '',

  // Adresse du site (laisser vide : détectée automatiquement)
  siteUrl: '',

  // Paiement en ligne (facultatif) : liens Stripe (https://buy.stripe.com/…)
  // Vides : l'utilisateur est invité à contacter son coach, qui active l'accès dans l'écran Comptes.
  paiementAbonnement: '',   // abonnement Standard, 15 €/mois
  paiementPartage: '',      // option « partager avec un coach »
  // Lien du portail client Stripe, pour que l'abonné gère ou résilie lui-même son abonnement (facultatif)
  portailAbonnement: ''
};
