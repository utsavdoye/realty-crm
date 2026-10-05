export const COUNTRIES: [string, string][] = [
  ['+91', 'India'], ['+971', 'UAE'], ['+1', 'USA / Canada'], ['+44', 'UK'], ['+65', 'Singapore'], ['+61', 'Australia'], ['+974', 'Qatar'],
  ['+966', 'Saudi Arabia'], ['+968', 'Oman'], ['+965', 'Kuwait'], ['+973', 'Bahrain'], ['+64', 'New Zealand'], ['+49', 'Germany'], ['+33', 'France'],
  ['+353', 'Ireland'], ['+31', 'Netherlands'], ['+60', 'Malaysia'], ['+852', 'Hong Kong'], ['+81', 'Japan'], ['+27', 'South Africa'], ['+254', 'Kenya'],
  ['+977', 'Nepal'], ['+94', 'Sri Lanka'], ['+880', 'Bangladesh'],
];

/** Joins country code + typed number into one value: India → 10 digits, others → +code digits. */
export function joinPhone(cc: string, typed: string) {
  let d = typed.replace(/\D/g, '');
  if (cc === '+91') { d = d.replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, ''); return d; }
  d = d.replace(/^0+/, '');
  const code = cc.replace('+', '');
  if (d.startsWith(code) && d.length > 9) d = d.slice(code.length);
  return d ? cc + d : '';
}
