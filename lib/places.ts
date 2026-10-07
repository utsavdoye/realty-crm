/**
 * Landmarks and area centres for the map — Raipur (main city) and Bengaluru (demo data).
 * The nearest-place lookup ignores anything more than 60 km away, so each project only sees its own city.
 * Positions are approximate (good to about a few hundred metres). Distances shown are straight-line,
 * so the app always says "about" and offers a Google Maps directions button for the real drive.
 */

export type PlaceKind = 'metro' | 'airport' | 'rail' | 'tech' | 'mall' | 'hospital' | 'school';
export type Place = { n: string; k: PlaceKind; lat: number; lng: number };

export const KIND_LABEL: Record<PlaceKind, string> = {
  metro: 'Metro', airport: 'Airport', rail: 'Railway / bus', tech: 'Offices / industry', mall: 'Mall', hospital: 'Hospital', school: 'School / college',
};
export const KIND_ICON: Record<PlaceKind, string> = {
  metro: 'M', airport: '✈', rail: 'R', tech: 'T', mall: 'S', hospital: '+', school: 'E',
};

const P = (k: PlaceKind, list: [string, number, number][]): Place[] => list.map(([n, lat, lng]) => ({ n, k, lat, lng }));

/** Default map centre when there are no projects yet: Raipur. */
export const CITY_CENTER: [number, number] = [21.2444, 81.6306];

/** Raipur, Chhattisgarh. Sources: Wikipedia, OpenStreetMap/GeoNames (mapcarta), latlong.net. Good to a few hundred metres. */
const RAIPUR: Place[] = [
  ...P('airport', [['Swami Vivekananda Airport, Raipur', 21.1814, 81.7406]]),
  ...P('rail', [['Raipur Junction railway station', 21.2578, 81.6303], ['ISBT Raipur (Bhatagaon)', 21.2196, 81.6311]]),
  ...P('hospital', [
    ['AIIMS Raipur', 21.2565, 81.5786], ['Dr. B.R. Ambedkar Hospital (Mekahara)', 21.2502, 81.6399], ['Ramkrishna CARE Hospital', 21.2131, 81.6537],
    ['Shri Narayana Hospital', 21.2636, 81.6498], ['MMI Narayana Hospital, Lalpur', 21.2133, 81.6577],
  ]),
  ...P('mall', [['Magneto The Mall', 21.2407, 81.6842], ['City Mall 36', 21.2364, 81.6858], ['Ambuja City Centre Mall', 21.2757, 81.6876]]),
  ...P('school', [
    ['NIT Raipur', 21.2494, 81.6049], ['IIM Raipur', 21.1211, 81.8246], ['Pt. Ravishankar Shukla University', 21.2469, 81.5974],
    ['Kendriya Vidyalaya No. 1', 21.2705, 81.6409], ['IIIT Naya Raipur', 21.1285, 81.7662], ['HNLU (National Law University)', 21.107, 81.7581],
  ]),
  ...P('tech', [
    ['Mantralaya, Atal Nagar (Naya Raipur)', 21.1611, 81.7915], ['Urla Industrial Area', 21.3084, 81.6192], ['Siltara Industrial Area', 21.3684, 81.6694],
    ['Collectorate, Civil Lines', 21.2453, 81.6429],
  ]),
];

export const PLACES: Place[] = [
  ...RAIPUR,
  ...P('airport', [['Kempegowda International Airport', 13.1986, 77.7066]]),
  ...P('rail', [
    ['KSR Bengaluru City station', 12.9781, 77.5695], ['Yesvantpur Junction', 13.0237, 77.5503], ['Bengaluru Cantonment station', 12.9937, 77.5975],
    ['KR Puram station', 12.9997, 77.677], ['SMVT Baiyappanahalli', 12.9907, 77.6585], ['Majestic bus stand', 12.9767, 77.5713],
  ]),
  // Purple line
  ...P('metro', [
    ['Kengeri metro', 12.9147, 77.4875], ['Mysuru Road metro', 12.9465, 77.53], ['Vijayanagar metro', 12.9709, 77.5372], ['Magadi Road metro', 12.9757, 77.5552],
    ['Majestic metro (interchange)', 12.9757, 77.5728], ['Vidhana Soudha metro', 12.9798, 77.5926], ['Cubbon Park metro', 12.981, 77.5975], ['MG Road metro', 12.9755, 77.6067],
    ['Trinity metro', 12.973, 77.617], ['Halasuru metro', 12.976, 77.6265], ['Indiranagar metro', 12.9783, 77.6387], ['Swami Vivekananda Road metro', 12.9858, 77.6448],
    ['Baiyappanahalli metro', 12.9907, 77.6522], ['KR Puram metro', 13.0004, 77.678], ['Singayyanapalya metro', 12.997, 77.69], ['Garudacharpalya metro', 12.9935, 77.704],
    ['Hoodi metro', 12.9888, 77.7115], ['Kundalahalli metro', 12.9775, 77.716], ['Nallurahalli metro', 12.9765, 77.727], ['Sri Sathya Sai Hospital metro', 12.981, 77.73],
    ['Pattandur Agrahara metro', 12.988, 77.739], ['Kadugodi Tree Park metro', 12.994, 77.75], ['Whitefield (Kadugodi) metro', 12.9956, 77.7579],
  ]),
  // Green line
  ...P('metro', [
    ['Nagasandra metro', 13.048, 77.5], ['Jalahalli metro', 13.04, 77.519], ['Peenya metro', 13.033, 77.533], ['Yeshwanthpur metro', 13.023, 77.55],
    ['Sandal Soap Factory metro', 13.0145, 77.554], ['Mahalakshmi metro', 13.008, 77.549], ['Rajajinagar metro', 13.0, 77.55], ['Mantri Square Sampige Road metro', 12.9905, 77.571],
    ['Chickpete metro', 12.9668, 77.5745], ['KR Market metro', 12.961, 77.5745], ['National College metro', 12.9505, 77.5735], ['Lalbagh metro', 12.9465, 77.58],
    ['South End Circle metro', 12.938, 77.58], ['Jayanagar metro', 12.9295, 77.58], ['RV Road metro (interchange)', 12.9215, 77.58], ['Banashankari metro', 12.915, 77.5735],
    ['JP Nagar metro', 12.9075, 77.573], ['Yelachenahalli metro', 12.896, 77.57], ['Konanakunte Cross metro', 12.885, 77.553], ['Doddakallasandra metro', 12.877, 77.545],
    ['Vajarahalli metro', 12.867, 77.542], ['Thalaghattapura metro', 12.86, 77.538], ['Silk Institute metro', 12.8615, 77.53],
  ]),
  // Yellow line
  ...P('metro', [
    ['Jayadeva Hospital metro', 12.917, 77.5995], ['BTM Layout metro', 12.916, 77.61], ['Central Silk Board metro', 12.9175, 77.623], ['Bommanahalli metro', 12.907, 77.63],
    ['Hongasandra metro', 12.898, 77.633], ['Kudlu Gate metro', 12.889, 77.639], ['Singasandra metro', 12.88, 77.645], ['Hosa Road metro', 12.872, 77.65],
    ['Electronic City metro', 12.848, 77.662], ['Infosys Konappana Agrahara metro', 12.842, 77.668], ['Hebbagodi metro', 12.828, 77.68], ['Bommasandra metro', 12.817, 77.69],
  ]),
  ...P('tech', [
    ['Manyata Tech Park', 13.0475, 77.6215], ['ITPL Whitefield', 12.9857, 77.7357], ['Infosys Electronic City', 12.8458, 77.6635], ['Bagmane Tech Park', 12.981, 77.661],
    ['Embassy Golf Links', 12.953, 77.641], ['RMZ Ecospace', 12.926, 77.681], ['Prestige Tech Park', 12.94, 77.695], ['Embassy Tech Village', 12.93, 77.69],
    ['Global Village Tech Park', 12.918, 77.498], ['Wipro Sarjapur Road', 12.912, 77.684], ['Bagmane WTC Mahadevapura', 12.99, 77.697], ['Brigade Tech Gardens', 12.972, 77.721],
    ['Kirloskar Business Park Hebbal', 13.043, 77.593], ['Ecoworld Bellandur', 12.927, 77.684],
  ]),
  ...P('mall', [
    ['Phoenix Marketcity Whitefield', 12.9975, 77.6964], ['Orion Mall', 13.011, 77.555], ['Phoenix Mall of Asia', 13.059, 77.5935], ['Nexus Koramangala (Forum)', 12.9346, 77.6113],
    ['UB City', 12.9716, 77.596], ['Mantri Square Mall', 12.9917, 77.5706], ['Nexus Shantiniketan', 12.9905, 77.73],
  ]),
  ...P('hospital', [
    ['Manipal Hospital Old Airport Road', 12.959, 77.649], ['Narayana Health City', 12.81, 77.695], ["St John's Hospital", 12.93, 77.62], ['Manipal Hospital Hebbal', 13.051, 77.593],
    ['Apollo Hospital Bannerghatta Road', 12.896, 77.598], ['Sakra World Hospital', 12.933, 77.689], ['Manipal Hospital Whitefield', 12.987, 77.73], ['Victoria Hospital', 12.963, 77.573],
    ['NIMHANS', 12.943, 77.596],
  ]),
  ...P('school', [
    ['IISc', 13.0219, 77.5671], ['IIM Bangalore', 12.8946, 77.601], ['Christ University', 12.9343, 77.606], ['PES University', 12.9345, 77.5345], ['RV College of Engineering', 12.9237, 77.4987],
    ['National Public School Indiranagar', 12.979, 77.64], ["Bishop Cotton Boys' School", 12.969, 77.598], ['DPS East (Sarjapur Road)', 12.893, 77.748], ['DPS North (Yelahanka)', 13.112, 77.623],
    ['Greenwood High (Sarjapur)', 12.892, 77.722], ['Inventure Academy', 12.9, 77.747], ['Indus International School', 12.853, 77.787], ['Canadian International School', 13.095, 77.622],
  ]),
];

/** Area centres, used to place leads (by the area they asked for) and to guess a project's spot. */
export const AREAS: Record<string, [number, number]> = {
  // Raipur
  'VIP Road': [21.2112, 81.6994], 'Shankar Nagar': [21.2539, 81.6618], Telibandha: [21.241, 81.6648], Amlidih: [21.2234, 81.6758], Saddu: [21.2795, 81.691],
  Mowa: [21.2676, 81.6669], Kachna: [21.2657, 81.7094], 'Devendra Nagar': [21.2624, 81.6431], Pandri: [21.2552, 81.6524], Tatibandh: [21.2596, 81.5774],
  Sejbahar: [21.1633, 81.6659], Dunda: [21.183, 81.6722], Boriyakhurd: [21.1951, 81.6506], Labhandi: [21.2382, 81.7015], 'Avanti Vihar': [21.2393, 81.669],
  'Civil Lines': [21.2372, 81.6542], 'Daldal Seoni': [21.2802, 81.6689], 'Naya Raipur': [21.161, 81.787], 'Atal Nagar': [21.161, 81.787],
  'Kamal Vihar': [21.1923, 81.6742], Lalpur: [21.2127, 81.6619], Bhatagaon: [21.2166, 81.6254], 'Mana Camp': [21.194, 81.717], 'Samta Colony': [21.2488, 81.6242],
  'Choubey Colony': [21.2465, 81.616], 'Shailendra Nagar': [21.2302, 81.6536], Fafadih: [21.2602, 81.6378], Gudhiyari: [21.2596, 81.6265], Tikrapara: [21.2206, 81.6415],
  'Sundar Nagar': [21.2282, 81.612], 'Purani Basti': [21.2335, 81.6306], Mathpurena: [21.2096, 81.6339], Amanaka: [21.2518, 81.5998], 'Ring Road No. 1': [21.2259, 81.6566],
  'Ring Road No. 2': [21.287, 81.6205], 'GE Road': [21.2451, 81.6382], Raipura: [21.2317, 81.6021], 'Kota Raipur': [21.2599, 81.6007], 'Byron Bazar': [21.2353, 81.6432],
  Moudhapara: [21.2497, 81.6358], Khamtarai: [21.2778, 81.634], Urkura: [21.3058, 81.6525], Birgaon: [21.3012, 81.6287], Abhanpur: [21.0528, 81.7456],
  Raipur: [21.2444, 81.6306],
  // Bengaluru
  'MG Road': [12.9756, 77.6066], Whitefield: [12.9698, 77.75], 'Sarjapur Road': [12.91, 77.687], 'Hennur Road': [13.0358, 77.64], 'Electronic City': [12.8452, 77.6602],
  'HSR Layout': [12.9116, 77.6474], Koramangala: [12.9352, 77.6245], Yelahanka: [13.1007, 77.5963], Hebbal: [13.0358, 77.597], Devanahalli: [13.2473, 77.712],
  'Kanakapura Road': [12.88, 77.56], 'Bannerghatta Road': [12.889, 77.597], 'JP Nagar': [12.9063, 77.5857], Marathahalli: [12.9569, 77.7011], Bellandur: [12.9304, 77.6784],
  Thanisandra: [13.057, 77.633], Rajajinagar: [12.991, 77.555], Jayanagar: [12.925, 77.5938], Indiranagar: [12.9719, 77.6412], 'KR Puram': [13.007, 77.696],
  Varthur: [12.9406, 77.7471], 'Mysore Road': [12.93, 77.5], 'Tumkur Road': [13.045, 77.505], Hoskote: [13.0707, 77.7982], 'Budigere Cross': [13.057, 77.755],
  'Hosur Road': [12.901, 77.63], Banashankari: [12.9255, 77.5468], Malleshwaram: [13.0035, 77.571], Basavanagudi: [12.9417, 77.5755], Yeshwanthpur: [13.028, 77.54],
  'RT Nagar': [13.021, 77.595], Kengeri: [12.908, 77.482], Nagarbhavi: [12.96, 77.51], Vijayanagar: [12.9719, 77.535], 'BTM Layout': [12.9166, 77.6101],
  'CV Raman Nagar': [12.985, 77.663], 'Kalyan Nagar': [13.028, 77.64], Banaswadi: [13.014, 77.651], Horamavu: [13.027, 77.66], 'Old Airport Road': [12.96, 77.648],
  Domlur: [12.961, 77.638], Brookefield: [12.966, 77.717], Mahadevapura: [12.989, 77.695], Kadugodi: [12.998, 77.76], Begur: [12.876, 77.629], Hulimavu: [12.879, 77.6],
  Attibele: [12.778, 77.77], Chandapura: [12.8, 77.703], Jakkur: [13.078, 77.606], 'Sahakar Nagar': [13.062, 77.588], Vidyaranyapura: [13.077, 77.558],
  Bagalur: [13.133, 77.668], 'Electronic City Phase 2': [12.84, 77.68], Sarjapur: [12.86, 77.786], Panathur: [12.94, 77.71], Kundalahalli: [12.967, 77.715],
  'Frazer Town': [12.999, 77.615], 'Cooke Town': [13.0, 77.625], 'Richmond Town': [12.96, 77.6], Ulsoor: [12.98, 77.62], 'Outer Ring Road': [12.935, 77.69],
};

export function areaPoint(location?: string | null): [number, number] | null {
  if (!location) return null;
  const s = location.toLowerCase();
  let best: [number, number] | null = null; let len = 0;
  for (const [name, pt] of Object.entries(AREAS)) {
    if (s.includes(name.toLowerCase()) && name.length > len) { best = pt; len = name.length; }
  }
  return best;
}

export function km(a: [number, number], b: [number, number]) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const NEAR_LIMIT_KM = 60;

/** Closest place of each kind (metro, airport, …) to a point, within 60 km (so a Raipur project never shows a Bengaluru metro). */
export function nearest(pt: [number, number], kinds: PlaceKind[] = ['metro', 'tech', 'hospital', 'school', 'mall', 'rail', 'airport']) {
  return kinds.map((k) => {
    let best: Place | null = null; let d = Infinity;
    for (const p of PLACES) if (p.k === k) { const x = km(pt, [p.lat, p.lng]); if (x < d) { d = x; best = p; } }
    return best && d <= NEAR_LIMIT_KM ? { ...best, km: d } : null;
  }).filter(Boolean) as (Place & { km: number })[];
}

export const fmtKm = (d: number) => (d < 1 ? `${Math.round(d * 1000 / 50) * 50} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);
export const directionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/** Reads "12.97, 77.59" or a Google Maps link and returns the point. */
export function parseLatLng(input: string): [number, number] | null {
  const s = decodeURIComponent(input || '');
  const m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}
