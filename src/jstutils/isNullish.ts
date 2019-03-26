// inspired from https://github.com/graphql/graphql-js/blob/926e4d80c558b107c49e9403e943086fa9b043a8/src/jsutils/isNullish.js

/**
 * Returns true if a value is null, undefined, or NaN.
 */
export default function isNullish(value: any) {
  return value === null || value === undefined || value !== value;
};
