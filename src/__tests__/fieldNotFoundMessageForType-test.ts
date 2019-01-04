import { GraphQLObjectType, GraphQLString, GraphQLScalarType } from "graphql";
import { fieldNotFoundMessageForType } from "..";

describe("fieldNotFoundMessageForType", () => {
  it("returns a helpful message for null", () => {
    expect(fieldNotFoundMessageForType(null)).toBe(
      "The type should not be null."
    );
  });

  it("returns a helpful message for scalar types", () => {
    expect(
      fieldNotFoundMessageForType(
        new GraphQLScalarType({
          name: "Odd",
          serialize(value) {
            return value % 2 === 1 ? value : null;
          }
        })
      )
    ).toBe("The field has a scalar type, which means it supports no nesting.");
  });

  it("returns all field names for object type", () => {
    expect(
      fieldNotFoundMessageForType(
        new GraphQLObjectType({
          name: "Row",
          fields: () => ({
            id: { type: GraphQLString }
          })
        })
      )
    ).toBe("The only fields found in this Object are: id.");
  });
});
