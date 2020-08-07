/**
 * `execute.ts` is the equivalent of `graphql-js`'s `src/execution/execute.js`:
 * it follows the same structure and same function names.
 *
 * The implementation of each function is very close to its sibling in `graphql-js`
 * and, for the most part, is just adapted for reactive execution (dealing with `Observable`).
 * Some functions are just copy-pasted because they did not require any change
 * but could not be imported from `graphql-js`.
 * Some functions are not present because they could be imported from `graphql-js`.
 */
import { Observable, of, from, isObservable, combineLatest, throwError } from "rxjs";
import { map, catchError, switchMap } from "rxjs/operators";
import { forEach,  isIterable } from "iterall";
import memoize from "memoizee";
import {
  ExecutionResult,
  DocumentNode,
  GraphQLObjectType,
  GraphQLSchema,
  FieldNode,
  GraphQLField,
  GraphQLOutputType,
  GraphQLFieldResolver,
  isObjectType,
  isNonNullType,
  responsePathAsArray,
  ExecutionArgs,
  OperationDefinitionNode,
  ResponsePath,
  GraphQLResolveInfo,
  GraphQLError,
  getOperationRootType,
  GraphQLList,
  GraphQLLeafType,
  isListType,
  isLeafType,
  isAbstractType,
  GraphQLAbstractType,
} from "graphql";

import {
  ExecutionResultDataDefault,
  assertValidExecutionArguments,
  buildExecutionContext,
  ExecutionContext,
  collectFields,
  buildResolveInfo,
  getFieldDef,
} from 'graphql/execution/execute';
import Maybe from 'graphql/tsutils/Maybe';
import { addPath } from "graphql/jsutils/Path";
import combinePropsLatest from "../rxutils/combinePropsLatest";
import { getArgumentValues } from "graphql/execution/values";
import { locatedError } from "graphql/error";
import invariant from "../jstutils/invariant";
import isInvalid from "../jstutils/isInvalid";
import inspect from "../jstutils/inspect";
import isNullish from "../jstutils/isNullish";
import mapPromiseToObservale from "../rxutils/mapPromiseToObservale";
import mapToFirstValue from "../rxutils/mapToFirstValue";

/**
 * Implements the "Evaluating requests" section of the GraphQL specification.
 *
 * Returns a RxJS's `Observable` of `ExecutionResult`.
 *
 * Note: reactive equivalent of `graphql-js`'s `execute`.
 */
export function execute<TData = ExecutionResultDataDefault>(args: ExecutionArgs)
  : Observable<ExecutionResult<TData>>;
export function execute<TData = ExecutionResultDataDefault>(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: unknown,
  contextValue?: unknown,
  variableValues?: Maybe<{ [key: string]: unknown }>,
  operationName?: Maybe<string>,
  fieldResolver?: Maybe<GraphQLFieldResolver<any, any>>
): Observable<ExecutionResult<TData>>;
export function execute<TData>(
  argsOrSchema,
  document?,
  rootValue?,
  contextValue?,
  variableValues?,
  operationName?,
  fieldResolver?,
) {
  return isExecutionArgs(argsOrSchema, arguments)
    ? executeImpl<TData>(
      argsOrSchema.schema,
      argsOrSchema.document,
      argsOrSchema.rootValue,
      argsOrSchema.contextValue,
      argsOrSchema.variableValues,
      argsOrSchema.operationName,
      argsOrSchema.fieldResolver,
    )
    : executeImpl<TData>(
      argsOrSchema,
      document,
      rootValue,
      contextValue,
      variableValues,
      operationName,
      fieldResolver,
    );
}

function isExecutionArgs(
  _argsOrSchema: GraphQLSchema | ExecutionArgs,
  args: IArguments
): _argsOrSchema is ExecutionArgs {
  return args.length === 1;
}

function executeImpl<TData>(
  schema: GraphQLSchema,
  document: DocumentNode,
  rootValue?: unknown,
  contextValue?: unknown,
  variableValues?: Maybe<{ [key: string]: unknown }>,
  operationName?: Maybe<string>,
  fieldResolver?: Maybe<GraphQLFieldResolver<any, any>>
): Observable<ExecutionResult<TData>> {
  // If arguments are missing or incorrect, throw an error.
  assertValidExecutionArguments(schema, document, variableValues);

  // If a valid execution context cannot be created due to incorrect arguments,
  // a "Response" with only errors is returned.
  const exeContext = buildExecutionContext(
    schema,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName,
    fieldResolver,
  );

  // Return early errors if execution context failed.
  if (!isValidExecutionContext(exeContext)) {
    return of({ errors: exeContext });
  }

  const data = executeOperation(exeContext, exeContext.operation, rootValue);
  return buildResponse<TData>(exeContext, data);
}

/**
 * Returns true if subject is a valid `ExecutionContext` and not array of `GraphQLError`.
 *
 * Note: reference implementation does a `Array.isArray` in `executeImpl` function body. In comparison,
 * `isValidExecutionContext` ensures typing correctness with type assertion.
 * @param subject value to be tested
 */
function isValidExecutionContext(subject: ReadonlyArray<GraphQLError> | ExecutionContext): subject is ExecutionContext {
  return !Array.isArray(subject);
}

/**
 * Given a completed execution context and data as Observable, build the `{ errors, data }`
 * response defined by the "Response" section of the GraphQL specification.
 *
 * Note: reactive equivalent of `graphql-js`'s `buildResponse`.
 */
function buildResponse<TData>(
  exeContext: ExecutionContext,
  data: Observable<{ [key: string]: unknown} | null>
): Observable<ExecutionResult<TData>> {
  // @ts-ignore `'{ [key: string]: unknown; }' is assignable to the constraint of type 'TData', but 'TData' could be instantiated with a different subtype of constraint '{}'`
  return data.pipe(map(d => {
    if (exeContext.errors.length === 0 && d !== null) {
      return {
        data: d,
      }
    } else {
      return {
        errors: exeContext.errors,
        data: d,
      }
    }
  }))
}

/**
 * Implements the "Evaluating operations" section of the spec.
 *
 * Note: reactive equivalent of `graphql-js`'s `executeOperation`. The difference lies
 * in the fact that, here, a RxJS's `Observable` is returned instead of a `Promise` (or plain value).
 */
function executeOperation(
  exeContext: ExecutionContext,
  operation: OperationDefinitionNode,
  rootValue: unknown
): Observable<({ [key: string]: unknown }) | null> {
  const type = getOperationRootType(exeContext.schema, operation);
  const fields = collectFields(
    exeContext,
    type,
    operation.selectionSet,
    Object.create(null),
    Object.create(null),
  );

  const path = undefined;

  // Errors from sub-fields of a NonNull type may propagate to the top level,
  // at which point we still log the error and null the parent field, which
  // in this case is the entire response.
  //
  // Similar to completeValueCatchingError.
  try {
    const result =
      operation.operation === 'mutation'
        ? executeFieldsSerially(exeContext, type, rootValue, path, fields)
        : executeFields(exeContext, type, rootValue, path, fields);
    return result;
  } catch (error) {
    exeContext.errors.push(error);
    return of(null);
  }
}

/**
 * Implements the "Evaluating selection sets" section of the spec for "write" mode,
 * ie with serial execution.
 *
 * Note: reactive equivalent of `graphql-js`'s `executeFieldsSerially`. The difference
 * lies in the fact that:
 * - here, a RxJS's `Observable` is returned instead of a `Promise` (or plain value)
 * - in `graphql-js`, serial execution is implemented by waiting, one by one, for the
 * resolution of the `Promise` returned by the resolution of each `field`. Here we wait
 * for the first value of the resolved `Observable` to be emited before passing to
 * the next field resolution.
 *
 * Thus, in case of resolvers resolving `Promises`, we match
 * reference implementation's behavior.
 */
function executeFieldsSerially(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  sourceValue: unknown,
  path: ResponsePath | undefined,
  fields: { [key: string]: FieldNode[]}
): Observable<{ [key: string]: unknown }> {
  const results: { [key: string]: Observable<unknown> } = {};

  // during iteration, we keep track of the result of the previously
  // resolved field so that we can queue the resolution of the next field
  // after the emition of the first value of the previous result.
  let previousResolvedResult: (Observable<unknown> | undefined);

  for (let i = 0, keys = Object.keys(fields); i < keys.length; ++i) {
    const responseName = keys[i];
    const fieldNodes = fields[responseName];
    const fieldPath = addPath(path, responseName);

    const resolve = () => resolveField(
      exeContext,
      parentType,
      sourceValue,
      fieldNodes,
      fieldPath,
    );

    const result = previousResolvedResult ?
      // queuing `resolve` after first emition of `previousResolvedResult`
      // using `mapToFirstValue` to get an Observable that represents this process
      mapToFirstValue(previousResolvedResult, resolve)
      :
      // first iteration: no previous result need to queue after
      resolve();

    previousResolvedResult = result;

    if (result !== undefined) {
      results[responseName] = result;
    }
  }

  return combinePropsLatest(results);
}

/**
 * Implements the "Evaluating selection sets" section of the spec
 * for "read" mode.
 *
 * Note: reactive equivalent of `graphql-js`'s `executeFields`. The difference lies
 * in the fact that, here, a RxJS's `Observable` is returned instead of a `Promise` (or plain value).
 */
function executeFields(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  sourceValue: unknown,
  path: ResponsePath | undefined,
  fields: { [key: string]: FieldNode[] }
): Observable<{ [key: string]: unknown }> {
  const results: { [key: string]: Observable<unknown> } = {};

  for (let i = 0, keys = Object.keys(fields); i < keys.length; ++i) {
    const responseName = keys[i];
    const fieldNodes = fields[responseName];
    const fieldPath = addPath(path, responseName);
    const result = resolveField(
      exeContext,
      parentType,
      sourceValue,
      fieldNodes,
      fieldPath,
    );

    if (result !== undefined) {
      results[responseName] = result;
    }
  }

  return combinePropsLatest(results);
}

/**
 * Resolves the field on the given source object.
 *
 * Note: reactive equivalent of `graphql-js`'s `resolveField`. The difference lies
 * in the fact that, here, a RxJS's `Observable` is returned instead of a `Promise` (or plain value).
 */
function resolveField(
  exeContext: ExecutionContext,
  parentType: GraphQLObjectType,
  source: unknown,
  fieldNodes: FieldNode[],
  path: ResponsePath,
): Observable<unknown> {
  const fieldNode = fieldNodes[0];
  const fieldName = fieldNode.name.value;

  const fieldDef = getFieldDef(exeContext.schema, parentType, fieldName);
  if (!fieldDef) {
    return of(undefined);
  }

  const resolveFn = fieldDef.resolve || exeContext.fieldResolver;

  const info = buildResolveInfo(
    exeContext,
    fieldDef,
    fieldNodes,
    parentType,
    path,
  );

  const result = resolveFieldValueOrError(
    exeContext,
    fieldDef,
    fieldNodes,
    resolveFn,
    source,
    info,
  );

  return completeValueCatchingError(
    exeContext,
    fieldDef.type,
    fieldNodes,
    info,
    path,
    result,
  );
}

/**
 * Note: reactive equivalent of `graphql-js`'s `resolveFieldValueOrError`. The difference lies
 * in the fact that, here, a RxJS's `Observable` is returned.
 */
function resolveFieldValueOrError<TSource>(
  exeContext: ExecutionContext,
  fieldDef: GraphQLField<TSource, any>,
  fieldNodes: ReadonlyArray<FieldNode>,
  resolveFn: GraphQLFieldResolver<TSource, any>,
  source: TSource,
  info: GraphQLResolveInfo
): (Error | Observable<unknown>) {
  try {
    const args = getArgumentValues(
      fieldDef,
      fieldNodes[0],
      exeContext.variableValues,
    );

    const contextValue = exeContext.contextValue;

    const result = resolveFn(source, args, contextValue, info);

    if (isObservable(result)) {
      return result
        .pipe(catchError(err => throwError(asErrorInstance(err))));
    }

    if (result instanceof Promise) {
      return from(result)
        .pipe(catchError(err => throwError(asErrorInstance(err))));
    }

    // it lloks like plain value
    return of(result)
  } catch (err) {
    return asErrorInstance(err);
  }
}

/**
 * Sometimes a non-error is thrown, wrap it as an Error instance to ensure a
 * consistent Error interface.
 *
 * Note: copy-paste of `graphql-js`'s `asErrorInstance` in `execute.js`.
 */
function asErrorInstance(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error('Unexpected error value: ' + inspect(error));
}

/**
 * This is a small wrapper around completeValue which detects and logs errors
 * in the execution context.
 *
 * Note: reactive equivalent of `graphql-js`'s `completeValueCatchingError`. The difference lies
 * in the fact that, here, a RxJS's `Observable` is returned.
 */
function completeValueCatchingError(
  exeContext: ExecutionContext,
  returnType: GraphQLOutputType,
  fieldNodes: ReadonlyArray<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: Error | Observable<unknown>,
): Observable<unknown> {
  if (result instanceof Error) {
    return of(handleFieldError(
      result,
      fieldNodes,
      path,
      returnType,
      exeContext,
      ));
  }
  try {
    return result
      .pipe(
        switchMap(res => completeValue(
          exeContext,
          returnType,
          fieldNodes,
          info,
          path,
          res,
          )
        )
      )
      .pipe(catchError(err => of(handleFieldError(
        asErrorInstance(err),
        fieldNodes,
        path,
        returnType,
        exeContext,
        ))))
    } catch (error) {
      return of(handleFieldError(
        asErrorInstance(error),
        fieldNodes,
        path,
        returnType,
        exeContext,
      ))
    }
}

/**
 * Note: copy-paste of `graphql-js`'s `handleFieldError`.
 */
function handleFieldError(
  rawError: Error,
  fieldNodes: ReadonlyArray<FieldNode>,
  path: ResponsePath,
  returnType: GraphQLOutputType,
  exeContext: ExecutionContext,
): null {
  const error = locatedError(
    asErrorInstance(rawError),
    fieldNodes,
    responsePathAsArray(path),
  );

  // If the field type is non-nullable, then it is resolved without any
  // protection from errors, however it still properly locates the error.
  if (isNonNullType(returnType)) {
    throw error;
  }

  // Otherwise, error protection is applied, logging the error and resolving
  // a null value for this field if one is encountered.
  exeContext.errors.push(error);
  return null;
}

/**
 * Implements the instructions for completeValue as defined in the
 * "Field entries" section of the spec.
 *
 * Note: reactive equivalent of `graphql-js`'s `completeValue`. The difference lies
 * in the fact that, here, we deal with RxJS's `Observable` and an `Observable` is returned.
 */
function completeValue(
  exeContext: ExecutionContext,
  returnType: GraphQLOutputType,
  fieldNodes: ReadonlyArray<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: unknown,
): Observable<unknown> {
  // If result is an Error, throw a located error.
  if (result instanceof Error) {
    throw result;
  }

  // If field type is NonNull, complete for inner type, and throw field error
  // if result is null.
  if (isNonNullType(returnType)) {
    const completed = completeValue(
      exeContext,
      returnType.ofType,
      fieldNodes,
      info,
      path,
      result,
    );
    if (completed === null) {
      throw new Error(
        `Cannot return null for non-nullable field ${info.parentType.name}.${
        info.fieldName
        }.`,
      );
    }
    return completed;
  }

  // If result value is null-ish (null, undefined, or NaN) then return null.
  if (isNullish(result)) {
    return of(null);
  }

  // If field type is List, complete each item in the list with the inner type
  if (isListType(returnType)) {
    return completeListValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result,
    );
  }

  // If field type is a leaf type, Scalar or Enum, serialize to a valid value,
  // returning null if serialization is not possible.
  if (isLeafType(returnType)) {
    return completeLeafValue(returnType, result);
  }

  // If field type is an abstract type, Interface or Union, determine the
  // runtime Object type and complete for that type.
  if (isAbstractType(returnType)) {
    return completeAbstractValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result,
    );
  }

  // If field type is Object, execute and complete all sub-selections.
  if (isObjectType(returnType)) {
    return completeObjectValue(
      exeContext,
      returnType,
      fieldNodes,
      info,
      path,
      result,
    );
  }

  // Not reachable. All possible output types have been considered.
  /* istanbul ignore next */
  throw new Error(
    `Cannot complete value of unexpected type "${inspect(
      (returnType),
    )}".`,
  );
};

/**
 * Complete a list value by completing each item in the list with the
 * inner type
 *
 * Note: reactive equivalent of `graphql-js`'s `completeListValue`. The difference lies
 * in the fact that, here, we deal with RxJS's `Observable` and an `Observable` is returned.
 */
function completeListValue(
  exeContext: ExecutionContext,
  returnType: GraphQLList<GraphQLOutputType>,
  fieldNodes: ReadonlyArray<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: unknown,
): Observable<ReadonlyArray<unknown>> {
  invariant(
    isIterable(result),
    `Expected Iterable, but did not find one for field ${
    info.parentType.name
    }.${info.fieldName}.`,
  );

  // for typescript only: asserts `result` type
  if (!isIterable(result)) throw new Error('Expected Iterable');

  const itemType = returnType.ofType;
  const completedResults: Observable<unknown>[] = [];

  forEach(result, (item, index) => {
    const fieldPath = addPath(path, index);
    const completedItem = completeValueCatchingError(
      exeContext,
      itemType,
      fieldNodes,
      info,
      fieldPath,
      of(item),
    );
    completedResults.push(completedItem);
  });

  // avoid blocking in switchMap with empty arrays
  if (completedResults.length === 0) return of([]);
  return combineLatest(completedResults);
}
/**
 * Complete a Scalar or Enum by serializing to a valid value, returning
 * null if serialization is not possible.
 *
 * Note: reactive equivalent of `graphql-js`'s `completeLeafValue`. The difference lies
 * in the fact that, here, an `Observable` is returned.
 */
function completeLeafValue(returnType: GraphQLLeafType, result: unknown): Observable<unknown> {
  invariant(returnType.serialize, 'Missing serialize method on type');
  const serializedResult = returnType.serialize(result);
  if (isInvalid(serializedResult)) {
    throw new Error(
      `Expected a value of type "${inspect(returnType)}" but ` +
      `received: ${inspect(result)}`,
    );
  }
  return of(serializedResult);
}
/**
 * Complete a value of an abstract type by determining the runtime object type
 * of that value, then complete the value for that type.
 *
 * Note: reactive equivalent of `graphql-js`'s `completeAbstractValue`. The difference lies
 * in the fact that, here, we deal with asychronisity in a Observable fashion and that
 * an `Observable` is returned.
 */
function completeAbstractValue(
  exeContext: ExecutionContext,
  returnType: GraphQLAbstractType,
  fieldNodes: ReadonlyArray<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: unknown,
): Observable<{ [key: string]: unknown }> {
  const runtimeType = returnType.resolveType
    ? returnType.resolveType(result, exeContext.contextValue, info)
    : defaultResolveTypeFn(result, exeContext.contextValue, info, returnType);

  return mapPromiseToObservale(
    Promise.resolve(runtimeType),
    resolvedRuntimeType => completeObjectValue(
      exeContext,
      ensureValidRuntimeType(
        resolvedRuntimeType,
        exeContext,
        returnType,
        fieldNodes,
        info,
        result,
      ),
      fieldNodes,
      info,
      path,
      result,
    )
  )
}

/**
 * Note: copy-pasted from `graphql-js`'s `ensureValidRuntimeType`.
 */
function ensureValidRuntimeType(
  runtimeTypeOrName: Maybe<GraphQLObjectType> | string,
  exeContext: ExecutionContext,
  returnType: GraphQLAbstractType,
  fieldNodes: ReadonlyArray<FieldNode>,
  info: GraphQLResolveInfo,
  result: unknown,
): GraphQLObjectType {
  const runtimeType =
    typeof runtimeTypeOrName === 'string'
      ? exeContext.schema.getType(runtimeTypeOrName)
      : runtimeTypeOrName;

  if (!isObjectType(runtimeType)) {
    throw new GraphQLError(
      `Abstract type ${returnType.name} must resolve to an Object type at ` +
      `runtime for field ${info.parentType.name}.${info.fieldName} with ` +
      `value ${inspect(result)}, received "${inspect(runtimeType)}". ` +
      `Either the ${returnType.name} type should provide a "resolveType" ` +
      'function or each possible type should provide an "isTypeOf" function.',
      fieldNodes,
    );
  }

  if (!exeContext.schema.isPossibleType(returnType, runtimeType)) {
    throw new GraphQLError(
      `Runtime Object type "${runtimeType.name}" is not a possible type ` +
      `for "${returnType.name}".`,
      fieldNodes,
    );
  }

  return runtimeType;
}

/**
 * Complete an Object value by executing all sub-selections.
 *
 * Note: reactive equivalent of `graphql-js`'s `completeObjectValue`. The difference lies
 * in the fact that, here, we deal with asychronisity in a Observable fashion and that
 * an `Observable` is returned.
 */
function completeObjectValue(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: ReadonlyArray<FieldNode>,
  info: GraphQLResolveInfo,
  path: ResponsePath,
  result: unknown,
): Observable<{ [key: string]: unknown }> {
  // If there is an isTypeOf predicate function, call it with the
  // current result. If isTypeOf returns false, then raise an error rather
  // than continuing execution.
  if (returnType.isTypeOf) {
    const isTypeOf = returnType.isTypeOf(result, exeContext.contextValue, info);

    if (isTypeOf instanceof Promise) {
      return mapPromiseToObservale(
        isTypeOf,
        resolvedIsTypeOf => {
          if (!resolvedIsTypeOf) {
            throw invalidReturnTypeError(returnType, result, fieldNodes);
          }

          return collectAndExecuteSubfields(
            exeContext,
            returnType,
            fieldNodes,
            path,
            result,
          );
        })
    }

    if (!isTypeOf) {
      throw invalidReturnTypeError(returnType, result, fieldNodes);
    }
  }

  return collectAndExecuteSubfields(
    exeContext,
    returnType,
    fieldNodes,
    path,
    result,
  );
}

/**
 *
 * Note: copy-pasted from `graphql-js`.
 */
function invalidReturnTypeError(
  returnType: GraphQLObjectType,
  result: unknown,
  fieldNodes: ReadonlyArray<FieldNode>,
): GraphQLError {
  return new GraphQLError(
    `Expected value of type "${returnType.name}" but got: ${inspect(result)}.`,
    fieldNodes,
  );
}

/**
 *
 * Note: reactive equivalent of `graphql-js`'s `collectAndExecuteSubfields`. The difference lies
 * in the fact that, here, an `Observable` is returned.
 */
function collectAndExecuteSubfields(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: ReadonlyArray<FieldNode>,
  path: ResponsePath,
  result: unknown,
): Observable<{ [key: string]: unknown }> {
  // Collect sub-fields to execute to complete this value.
  const subFieldNodes = collectSubfields(exeContext, returnType, fieldNodes);
  return executeFields(exeContext, returnType, result, path, subFieldNodes);
}

/**
 * A memoized collection of relevant subfields with regard to the return
 * type. Memoizing ensures the subfields are not repeatedly calculated, which
 * saves overhead when resolving lists of values.
 *
 * Note: copy-pasted from `graphql-js`. The difference lies in the fact that
 * `graphql-js` implements its own memoization, while we use `memoizee` package.
 */
const collectSubfields = memoize(_collectSubfields);
function _collectSubfields(
  exeContext: ExecutionContext,
  returnType: GraphQLObjectType,
  fieldNodes: ReadonlyArray<FieldNode>,
): { [key: string]: FieldNode[] } {
  let subFieldNodes = Object.create(null);
  const visitedFragmentNames = Object.create(null);
  for (let i = 0; i < fieldNodes.length; i++) {
    const selectionSet = fieldNodes[i].selectionSet;
    if (selectionSet) {
      subFieldNodes = collectFields(
        exeContext,
        returnType,
        selectionSet,
        subFieldNodes,
        visitedFragmentNames,
      );
    }
  }
  return subFieldNodes;
}

type MaybePromise<T> = T | Promise<T>;

/**
 * If a resolveType function is not given, then a default resolve behavior is
 * used which attempts two strategies:
 *
 * First, See if the provided value has a `__typename` field defined, if so, use
 * that value as name of the resolved type.
 *
 * Otherwise, test each possible type for the abstract type by calling
 * isTypeOf for the object being coerced, returning the first type that matches.
 * Note: copy-pasted from `graphql-js`
 */
function defaultResolveTypeFn(
  value: unknown,
  contextValue: unknown,
  info: GraphQLResolveInfo,
  abstractType: GraphQLAbstractType,
): MaybePromise<Maybe<GraphQLObjectType> | string> {
  // First, look for `__typename`.
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value['__typename'] === 'string'
  ) {
    return value['__typename'];
  }

  // Otherwise, test each possible type.
  const possibleTypes = info.schema.getPossibleTypes(abstractType);
  const promisedIsTypeOfResults: Promise<boolean>[] = [];

  for (let i = 0; i < possibleTypes.length; i++) {
    const type = possibleTypes[i];

    if (type.isTypeOf) {
      const isTypeOfResult = type.isTypeOf(value, contextValue, info);

      if (isTypeOfResult instanceof Promise) {
        promisedIsTypeOfResults[i] = isTypeOfResult;
      } else if (isTypeOfResult) {
        return type;
      }
    }
  }

  if (promisedIsTypeOfResults.length) {
    return Promise.all(promisedIsTypeOfResults).then(isTypeOfResults => {
      for (let i = 0; i < isTypeOfResults.length; i++) {
        if (isTypeOfResults[i]) {
          return possibleTypes[i];
        }
      }
    });
  }
}
