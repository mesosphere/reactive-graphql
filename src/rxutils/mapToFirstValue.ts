import { Observable } from "rxjs";
import { switchMap, take } from "rxjs/operators";

/**
 * Will wait for the first value of the given Observable
 * for mapping and emits the value of the Observable
 * returned by `mappingFn`.
 *
 * @param observable
 * @param mappingFn 
 */
export default function mapToFirstValue<TObservableValue, TMappedObservableValue>(
  observable: Observable<TObservableValue>,
  mappingFn: (firstValue: TObservableValue) => Observable<TMappedObservableValue>
): Observable<TMappedObservableValue> {
  return observable
    .pipe(take(1))
    .pipe(switchMap(mappingFn))
};
