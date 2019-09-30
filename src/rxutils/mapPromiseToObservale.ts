import { Observable, from } from "rxjs";
import { switchMap } from "rxjs/operators";

/**
 * Build an Observable given a Promise's resolved value.
 *
 * @param promise 
 * @param observableFn 
 */
export default function mapPromiseToObservale<TPromiseValue, TObservableValue>(
  promise: Promise<TPromiseValue>,
  observableFn: (resolved: TPromiseValue) => Observable<TObservableValue>
): Observable<TObservableValue> {
  return from(promise).pipe(switchMap(observableFn));
};
