/** Delat tillstånd och en enkel händelsebuss så att vyerna kan uppdatera varandra. */

export const S = {
  anvandare: null,
  installningar: {},
  omraden: [],
  adresser: [],
  valtOmrade: '',
  position: null,     // { lat, lon } från telefonens GPS
  vy: 'karta',
};

export const buss = new EventTarget();

/** Ropas när dörrdata ändrats så att karta, listor och dashboard laddas om. */
export function dataAndrad() {
  buss.dispatchEvent(new Event('data'));
}

export const arRoll = (minst) => {
  const rang = { saljare: 1, teamleader: 2, admin: 3 };
  return (rang[S.anvandare?.roll] || 0) >= rang[minst];
};

export const adressenMed = (id) => S.adresser.find((a) => a.id === id);

export const omradetsNamn = (id) => (S.omraden.find((o) => o.id === id) || {}).namn || '';
