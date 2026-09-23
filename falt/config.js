/**
 * Fältsystemets server. Adressen skrivs ut av uppsättningen
 * (Actions → Sätt upp fältsystemet, eller worker-falt/satt-upp.sh).
 *
 * Byter du Cloudflare-konto eller workernamn — ändra här.
 * Adressen är inte hemlig: allt bakom den kräver inloggning.
 */
export const STANDARD_SERVER = 'https://autoads-falt.emilgrigoryan29.workers.dev';

/** Visas på inloggningsskärmen, så att det syns vilken version en telefon kör. */
export const VERSION = '2026-09-23.1';

/**
 * Googles karta. Fylls i av uppsättningen från GitHub-hemligheterna
 * GOOGLE_MAPS_NYCKEL och GOOGLE_MAPS_KARTID — skriv aldrig in dem här.
 * Tomma = OpenStreetMap-kartan, som alltid finns kvar som reserv.
 */
export const GOOGLE_MAPS_NYCKEL = '';
export const GOOGLE_MAPS_KARTID = '';
