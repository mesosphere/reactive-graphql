import { Observable, of } from "rxjs";
import { execute } from "./execution/reactive-execute";
import { ExecutionResult, validateSchema, parse, validate, GraphQLSchema, Source, GraphQLFieldResolver, DocumentNode } from "graphql";
import Maybe from "graphql/tsutils/Maybe";

export type GraphQLArgs = {
  schema: GraphQLSchema;
  source: string | Source;
  rootValue?: unknown;
  contextValue?: unknown;
  variableValues?: Maybe<{ [key: string]: any }>,
  operationName?: string | null;
  fieldResolver?: GraphQLFieldResolver<any, any> | null;
};

function isGraphQLArgs(
  _argsOrSchema: GraphQLSchema | GraphQLArgs,
  args: IArguments
): _argsOrSchema is GraphQLArgs {
  return args.length === 1;
}

export function graphql<TData>(arg0: GraphQLArgs): Observable<ExecutionResult<TData>>;

export function graphql<TData>(
  schema: GraphQLSchema,
  source: Source | string,
  rootValue?: unknown,
  contextValue?: unknown,
  variableValues?: Maybe<{ [key: string]: any }>,
  operationName?: string | null,
  fieldResolver?: GraphQLFieldResolver<any, any> | null,
): Observable<ExecutionResult<TData>>;

export function graphql(
  argsOrSchema,
  source?,
  rootValue?,
  contextValue?,
  variableValues?,
  operationName?,
  fieldResolver?,

) {
  return isGraphQLArgs(argsOrSchema, arguments)
      ? graphqlImpl(
        argsOrSchema.schema,
        argsOrSchema.source,
        argsOrSchema.rootValue,
        argsOrSchema.contextValue,
        argsOrSchema.variableValues,
        argsOrSchema.operationName,
        argsOrSchema.fieldResolver,
      )
      : graphqlImpl(
        argsOrSchema,
        source,
        rootValue,
        contextValue,
        variableValues,
        operationName,
        fieldResolver,
      );
}

function graphqlImpl<TData>(
  schema: GraphQLSchema,
  source: string | Source,
  rootValue?: any,
  contextValue?: any,
  variableValues?: Maybe<{ [key: string]: any }>,
  operationName?: string | null,
  fieldResolver?: GraphQLFieldResolver<any, any> | null,
): Observable<ExecutionResult<TData>> {
  // Validate Schema
  const schemaValidationErrors = validateSchema(schema);
  if (schemaValidationErrors.length > 0) {
    return of({ errors: schemaValidationErrors });
  }

  // Parse
  let document: DocumentNode;
  try {
    document = parse(source);
  } catch (syntaxError) {
    return of({ errors: [syntaxError] });
  }

  // Validate
  const validationErrors = validate(schema, document);
  if (validationErrors.length > 0) {
    return of({ errors: validationErrors });
  }

  // Execute
  return execute(
    schema,
    document,
    rootValue,
    contextValue,
    variableValues,
    operationName,
    fieldResolver,
  );
}
