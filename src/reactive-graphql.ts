import { Observable, of, from, throwError, isObservable } from "rxjs";
import { concatMap, map, combineLatest } from "rxjs/operators";

import {
  DefinitionNode,
  DocumentNode,
  getNamedType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  SelectionNode,
  FieldNode,
  GraphQLField,
  GraphQLFieldResolver,
  isTypeSystemDefinitionNode,
  isTypeSystemExtensionNode,
  Kind,
  ArgumentNode,
  isScalarType,
  isEnumType,
  isObjectType,
  parse
} from "graphql";

import isNullish from './jstutils/isNullish';

// WARNING: This is NOT a spec complete graphql implementation
// https://facebook.github.io/graphql/October2016/

interface TypeMap {
  [key: string]: GraphQLType;
}

interface Schema extends GraphQLSchema {
  _typeMap?: TypeMap;
}

interface OperationNode {
  operation: "query" | "mutation";
}

type SchemaNode = SelectionNode | DefinitionNode;

function isOperationDefinition(node: any): node is OperationNode {
  return node.kind === Kind.OPERATION_DEFINITION;
}
function isFieldNode(node: SchemaNode): node is FieldNode {
  return node.kind === Kind.FIELD;
}

// We don't treat OperationDefinitions as Definitions but as entry points for our execution
function isDefinitionNode(node: SchemaNode): node is DefinitionNode {
  return (
    node.kind === Kind.FRAGMENT_DEFINITION ||
    isTypeSystemDefinitionNode(node) ||
    isTypeSystemExtensionNode(node)
  );
}

interface FieldWithResolver extends GraphQLField<any, any> {
  resolve: GraphQLFieldResolver<any, any, any>;
}

function isFieldWithResolver(
  field: GraphQLField<any, any>
): field is FieldWithResolver {
  return field.resolve instanceof Function;
}

export default function graphql<T = object>(
  schema: Schema,
  query: string | DocumentNode,
  rootValue?: any,
  context: object = {},
  variables: object = {}
): Observable<{ data?: T; errors?: string[] }> {
  // Parse
  let doc;
  if (typeof query === "string") {
    try {
      doc = parse(query);
    } catch (syntaxError) {
      return of({ errors: [syntaxError] });
    }
  } else {
    doc = query;
  }

  if (doc.definitions.length !== 1) {
    return throwObservable("query must have a single definition as root");
  }

  if (!schema._typeMap) {
    return throwObservable("schema must have a typeMap");
  }

  const types = schema._typeMap;

  return resolve(doc.definitions[0], context, variables, rootValue, null).pipe(
    map((data: T) => ({
      data
    }))
  );

  function resolve(
    definition: SchemaNode,
    context: object,
    variables: object,
    parent: any,
    type: GraphQLType | null
  ) {
    if (isOperationDefinition(definition)) {
      const nextType = getResultType(type, definition, parent);

      return resolveResult(definition, context, variables, parent, nextType);
    }

    // The definition gives us the field to resolve
    if (isFieldNode(definition)) {
      const field = getField(type, definition);

      // Something unexpcected was passed into getField
      if (field === null) {
        return throwObservable(
          `field '${
            definition.name.value
          }' was not found on type '${type}'. ${fieldNotFoundMessageForType(
            type
          )}`
        );
      }

      const resolvedObservable = resolveField(
        field,
        definition,
        context,
        variables,
        parent
      )
      // If result value is null-ish (null, undefined, or NaN) then return null.
      .pipe(map(value => isNullish(value) ? null : value));

      // Directly return the leaf nodes
      if (definition.selectionSet === undefined) {
        return resolvedObservable;
      }

      return resolvedObservable.pipe(
        concatMap(emitted => {
          if (!emitted) {
            return throwObservable("resolver emitted empty value");
          }

          if (emitted instanceof Array) {
            return resolveArrayResults(
              definition,
              context,
              variables,
              emitted,
              type
            );
          }

          const nextType = getResultType(type, definition, emitted);
          return resolveResult(
            definition,
            context,
            variables,
            emitted,
            nextType
          );
        })
      );
    }

    // It is no operationDefinitionand no fieldNode, so it seems like an error
    return throwObservable(
      "Input does not look like OperationDefinition nor FieldNode"
    );
  }

  // Goes one level deeper into the query nesting
  function resolveResult(
    definition: SchemaNode,
    context: object,
    variables: object,
    parent: any,
    type: GraphQLType | null
  ): Observable<any> {
    if (isDefinitionNode(definition)) {
      return throwObservable("Definition types should not be present here");
    }

    if (definition.kind === Kind.FRAGMENT_SPREAD) {
      return throwObservable("Unsupported use of fragments");
    }

    if (!definition.selectionSet) {
      return of(parent);
    }

    return definition.selectionSet.selections.reduce((acc, sel) => {
      if (
        sel.kind === Kind.FRAGMENT_SPREAD ||
        sel.kind === Kind.INLINE_FRAGMENT
      ) {
        return throwObservable("Unsupported use of fragments in selection set");
      }

      const result = resolve(sel, context, variables, parent, type);
      const fieldName = (sel.alias || sel.name).value;

      return acc.pipe(combineLatest(result, objectAppendWithKey(fieldName)));
    }, of({}));
  }

  function resolveArrayResults(
    definition: SchemaNode,
    context: object,
    variables: object,
    parents: any[],
    parentType: GraphQLType | null
  ) {
    return parents.reduce((acc, result) => {
      const nextType = getResultType(parentType, definition, result);
      const resultObserver = resolveResult(
        definition,
        context,
        variables,
        result,
        nextType
      );

      return acc.pipe(
        combineLatest(
          // TODO: fix this type overwrite
          (resultObserver as unknown) as Observable<any>[],
          function(destination: Observable<any>[], source: Observable<any>) {
            return destination.concat(source);
          }
        )
      );
    }, of([]));
  }

  function getField(
    parentType: GraphQLType | null,
    definition: SchemaNode
  ): GraphQLField<any, any> | null {
    // Go one level deeper into the query
    if (parentType instanceof GraphQLObjectType && isFieldNode(definition)) {
      const parentFields = parentType.getFields();
      const fieldName = definition.name.value;

      if (parentFields[fieldName]) {
        return parentFields[definition.name.value];
      }
    }

    // These cases should ideally at some point be not existant,
    // but due to our partial implementation this loop-hole is needed
    return null;
  }

  function getResultType(
    parentType: GraphQLType | null,
    definition: SchemaNode,
    instance: any
  ): GraphQLType | null {
    const translateOperation = {
      query: "Query",
      mutation: "Mutation"
    };

    // Operation is given (query or mutation), returns a type
    if (isOperationDefinition(definition)) {
      return types[translateOperation[definition.operation]];
    }

    // Get one level deeper in the query nesting
    const field = getField(parentType, definition);
    if (field !== null) {
      const fieldType = getNamedType(field.type);

      // Make this abstract type concrete if possible
      if (
        fieldType instanceof GraphQLInterfaceType &&
        fieldType.resolveType instanceof Function
      ) {
        // We currenlty only allow resolveType to return a GraphQLObjectType
        // and we pass in the wrong values as we don't need this feature currently
        // @ts-ignore
        return getNamedType(fieldType.resolveType(instance));
      } else {
        return fieldType;
      }
    }

    return null;
  }
}

function throwObservable(error: string): Observable<any> {
  return throwError(new Error(`reactive-graphql: ${error}`));
}

function buildResolveArgs(definition: FieldNode, variables: object) {
  return (definition.arguments || []).reduce(
    (carry, arg) => ({
      ...carry,
      ...(arg.value.kind === Kind.VARIABLE
        ? // @ts-ignore
          { [arg.name.value]: variables[arg.value.name.value] }
        : {
            [arg.name.value]: getArgValue(arg)
          })
    }),
    {}
  );
}

function getArgValue(arg: ArgumentNode): any {
  if (arg.value.kind === "NullValue" || arg.value.kind === "Variable") {
    return null;
  }

  if (arg.value.kind === "ListValue") {
    return arg.value.values;
  }

  if (arg.value.kind === "ObjectValue") {
    return arg.value.fields;
  }

  return arg.value.value;
}

const objectAppendWithKey = (key: string) => {
  return (destination: object, source: any) => ({
    ...destination,
    [key]: source
  });
};

function resolveField(
  field: GraphQLField<any, any, { [argName: string]: any }>,
  definition: FieldNode,
  context: object,
  variables: object,
  parent: any
): Observable<any> {
  if (!isFieldWithResolver(field)) {
    return of(parent[field.name]);
  }

  const args = buildResolveArgs(definition, variables);
  try {
    const resolvedValue = field.resolve(
      parent,
      args,
      context,
      // @ts-ignore
      null // that would be the info
    );

    if (isObservable(resolvedValue)) {
      return resolvedValue;
    }

    if (resolvedValue instanceof Promise) {
      return from(resolvedValue);
    }

    // It seems like a plain value
    return of(resolvedValue);
  } catch (err) {
    return throwObservable(
      `resolver '${field.name}' throws this error: '${err}'`
    );
  }
}

export function fieldNotFoundMessageForType(type: GraphQLType | null): string {
  if (type === null) {
    return "The type should not be null.";
  }

  if (isScalarType(type)) {
    return "The field has a scalar type, which means it supports no nesting.";
  }

  if (isEnumType(type)) {
    return "The field has an enum type, which means it supports no nesting.";
  }

  if (isObjectType(type)) {
    return `The only fields found in this Object are: ${Object.keys(
      type.getFields()
    )}.`;
  }

  return "";
}
