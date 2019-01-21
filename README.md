# Reactive GraphQL
> GraphQL reactive executor

[![npm version](https://badge.fury.io/js/reactive-graphql.svg)](https://badge.fury.io/js/reactive-graphql)

Execute GraphQL queries against reactive resolvers (resolvers that return Observable) to get a reactive results.

_This project aims to become a complete GraphQL implementation based around [RxJS](https://github.com/ReactiveX/rxjs)._

## Install
```
$ npm i reactive-graphql --save
```

## Usage
The usage is very similar to `graphql-js`'s [`graphql`](https://graphql.org/graphql-js/graphql/#graphql) function, except that:
- resolvers can return an Observable
- the returned value is an Observable

```js
import { makeExecutableSchema } from 'graphql-tools';
import gql from 'graphql-tag';
import graphql  from 'reactive-graphql';

const typeDefs = `
  type Query {
    time: Int!
  }
`;

const resolvers = {
  Query: {
    // resolvers can return an Observable 
    time: () => {
      // Observable that emits increasing numbers every 1 second
      return timer(1000, 1000);
    },
  }
}

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});


const query = gql`
  query {
    time
  }
`;

const stream = graphql(query, schema);
// stream is an Observable
stream.subscribe(res => console.log(res))
```

outputs

```
0
1
2
3
...
```

## API
The first argument you pass into `reactive-graphql` is an executable schema, the second one a parsed GraphQL query. You can pass in the root context as an object as a third parameter. The variables can be passed as 4th parameter.

The implementation will always return an Observable.
If any of the resolvers returns an error the implementation will emit the error on the stream.
Otherwise the data will be wrapped in a `{ data }` object, like most implementations handle this.

## Caveats
Unsupported GraphQL features:
- fragments of all kinds
- subscriptions (as everything is treated as a subscription)

## See Also
- [reactive-graphql-react](https://github.com/DanielMSchmidt/reactive-graphql-react)
- [apollo-link-reactive-schema](https://github.com/getstation/apollo-link-reactive-schema)
- [@dcos/data-service](https://github.com/dcos-labs/data-service)
- [graphql-rxjs](https://github.com/DxCx/graphql-rxjs/)

## Advanced usage [![Edit](https://codesandbox.io/static/img/play-codesandbox.svg)](https://codesandbox.io/s/github/DanielMSchmidt/reactive-graphql-demo/tree/master/?hidenavigation=1)
```js
import React from "react";
import ReactDOM from "react-dom";
import "./styles.css";

import graphql from "reactive-graphql";

import { makeExecutableSchema } from "graphql-tools";
import gql from "graphql-tag";
import { from, interval, of } from "rxjs";
import { map, merge, scan, combineLatest } from "rxjs/operators";
import { componentFromStream } from "@dcos/data-service";

// mocked API clients that return Observables
const oldPosts = from(["my first post", "a second post"]);
const newPosts = interval(3000).pipe(map(v => `Blog Post #${v + 1}`));
const fetchPosts = () =>
  oldPosts.pipe(
    merge(newPosts),
    scan((acc, item) => [...acc, item], [])
  );
const votesStore = {};
const fetchVotesForPost = name => of(votesStore[name] || 0);

const schema = makeExecutableSchema({
  typeDefs: `
  type Post {
    id: Int!
    title: String!
    votes: Int!
  }

  # the schema allows the following query:
  type Query {
    posts: [Post]
  }

  # this schema allows the following mutation:
  type Mutation {
    upvotePost (
      postId: Int!
    ): Post
  }
  `,
  resolvers: {
    Query: {
      posts(parent, args, context) {
        return fetchPosts().pipe(
          map(emittedValue =>
            emittedValue.map((value, index) => ({ id: index, title: value }))
          )
        );
      }
    },
    Post: {
      votes(parent, args, context) {
        return fetchVotesForPost(parent.title);
      }
    }
  }
});

const query = gql`
  query {
    posts {
      title
      votes
    }
  }
`;

const postStream = graphql(query, schema);
const PostsList = componentFromStream(propsStream =>
  propsStream.pipe(
    combineLatest(postStream, (props, result) => {
      const {
        data: { posts }
      } = result;

      return posts.map(post => (
        <div>
          <h3>{post.title}</h3>
        </div>
      ));
    })
  )
);

function App() {
  return (
    <div className="App">
      <PostsList />
    </div>
  );
}

const rootElement = document.getElementById("root");
ReactDOM.render(<App />, rootElement);
```

## License

Apache 2.0
