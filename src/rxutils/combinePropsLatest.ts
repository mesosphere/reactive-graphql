import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Combine multiple Observables passed as an object to create
 * an Observable that emits an object with the same keys and,
 * as values, the latest values of each of the corresponding
 * input Observables.
 *
 * Like `combineLatest` but for object properties instead of
 * iterable of Observables.
 * 
 * @param input 
 */
function combinePropsLatest(
  input: { [key: string]: Observable<any> }
  ): Observable<{[key: string]: any}> {
  const keys = Object.keys(input);
  return combineLatest(
    keys.map(key => input[key])
  ).pipe(map(resultArray => {
    const results: { [key: string]: any } = {};
    resultArray.forEach((result, i) => {
      results[keys[i]] = result;
    })
    return results;
  }))
}

export default combinePropsLatest;
