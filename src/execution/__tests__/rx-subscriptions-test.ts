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
  });

  describe('giving up a resolved Observable', () => {
    const executeScenario = (
      currentEmitter$: TestObservableLike<string>,
      emitter$s: {
        [key: string]: TestObservableLike<string>,
      },
      ) => {
      const schema = makeExecutableSchema({
        typeDefs: `
        type Emitter {
          value: String!
        }
        type Query {
          currentEmitter: Emitter!
        }`,
        resolvers: {
          Query: {
            currentEmitter: () => currentEmitter$,
          },
          Emitter: {
            value: (p: string) => emitter$s[p]
          }
        }
      });

      return execute({
        schema,
        document: parse(`
          query {
            currentEmitter {
              value
            }
          }
        `)
      })
    }

    it('should unsubscribe from it (switchMap)', marbles(m => {
      const currentEmitter$ = m.hot(
        '-A-----B---'
      );
      const AEmitter = m.hot(
        'aaaaaaaaaaa'
      );
      const BEmitter = m.hot(
        'bbbbbbbbbbb'
      );
      const emitter$s = {
        A: AEmitter,
        B: BEmitter,
      }
      m.expect(
        executeScenario(currentEmitter$, emitter$s),
        '^---------!'
      ).toBeObservable(
      // -A-----B---
        '-aaaaaabbb-', {
        a: { data: { currentEmitter: { value: 'a' }}},
        b: { data: { currentEmitter: { value: 'b' }}},
      }
      )
      m.expect(AEmitter).toHaveSubscriptions(
      // -A-----B---
        '-^-----!--'
      )
      m.expect(BEmitter).toHaveSubscriptions(
      // -A-----B---
        '-------^--!'
      )
    }));
  })
});
