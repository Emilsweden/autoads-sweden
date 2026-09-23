/** Delat tillstånd och en enkel händelsebuss så att vyerna kan uppdatera varandra. */

export const S = {
  anvandare: null,
  installningar: {},
  omraden: [],
  adresser: [],
  valtOmrade: '',
  position: null,     // { lat, lon, noggrannhet } från telefonens GPS
  positionTid: 0,     // när positionen senast uppdaterades
  vy: 'karta',
};

export const buss = new EventTarget();

/** Ropas när dörrdata ändrats så att karta, listor och dashboard laddas om. */
export function dataAndrad() {
  buss.dispatchEvent(new Event('data'));
}

/** Rangen måste stämma med ROLLER i workern. Okänd roll ger 0. */
const RANG = { besiktare: 1, saljare: 1, saljadmin: 2, bokare_plus: 2, teamleader: 3, admin: 4 };

export const arRoll = (minst) => (RANG[S.anvandare?.roll] || 0) >= RANG[minst];

/**
 * Får den inloggade göra det här? Listan kommer från servern vid inloggning,
 * så appen och API:t är alltid överens. Det är ändå servern som avgör —
 * det här styr bara vad som ritas.
 */
export const kan = (formaga) => {
  const lista = (S.anvandare && S.anvandare.formagor) || [];
  return lista.includes('*') || lista.includes(formaga);
};

export const arBesiktare = () => S.anvandare?.roll === 'besiktare';

export const adressenMed = (id) => S.adresser.find((a) => a.id === id);

export const omradetsNamn = (id) => (S.omraden.find((o) => o.id === id) || {}).namn || '';
