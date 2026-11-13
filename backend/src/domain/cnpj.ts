/**
 * Validation for numeric and alphanumeric Brazilian CNPJs.
 * Public document validity does not verify company status or representation.
 */
export function normalizeCnpj(input: string): string {
  return input.toUpperCase().replace(/[.\/\-\s]/g, "");
}

const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(chars: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + (chars.charCodeAt(index) - 48) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const first = checkDigit(cnpj.slice(0, 12), firstWeights);
  const second = checkDigit(cnpj.slice(0, 12) + first, secondWeights);
  return cnpj.endsWith(String(first) + String(second));
}
