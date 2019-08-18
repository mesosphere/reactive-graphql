/**
 * Returns true if a value is undefined, or NaN.
 */
export default function isInvalid(value: any): boolean {
  return value === undefined || value !== value;
}
