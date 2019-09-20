import { makeExecutableSchema } from "graphql-tools";
import { marbles } from "rxjs-marbles/jest";
import { TestObservableLike } from "rxjs-marbles/types";
import { parse } from "graphql";
import { execute } from "../..";

// verify 
describe('Execution: Rx subscriptions', () => {
  describe('subscription/unsubscription sycnhronization of resolved observable with result of query', () => {
    const executeScenario = (
      revolvedValue$: TestObservableLike<string>,
    ) => {
      const schema = makeExecutableSchema({
        typeDefs: `
        type Query {
          value: String!
        }`,
        resolvers: {
          Query: {
            value: () => revolvedValue$,
          }
        }
      });
    
      return execute({
        schema,
        document: parse(`
          query {
            value
          }
        `)
      })
    }
  
    it('should wait for result subscription to subscribe to Observable returned by resolver', marbles(m => {
      const value$ = m.hot(
        '-a--b--c---'
      )
      m.expect(
        executeScenario(value$),
        '--^--------'
      ).toBeObservable(
        '----B--C---', {
          B: { data: { value: 'b' } },
          C: { data: { value: 'c' } },
        }
      )
      m.expect(value$).toHaveSubscriptions(
        '--^--------'
      )
    }));
  
    it('should unsubsribe from Observable returned by resolver when unsubscribe from result', marbles(m => {
      const value$ = m.hot(
        '-a--b--c---'
      )
      m.expect(
        executeScenario(value$),
        '^----!----'
      ).toBeObservable(
        '-A--B------', {
          A: { data: { value: 'a' } },
          B: { data: { value: 'b' } },
        }
      )
      m.expect(value$).toHaveSubscriptions(
        '^----!----'
      )
    }));
  })
});
