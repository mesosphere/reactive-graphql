# Reactive GraphQL

> GraphQL reactive executor

[![npm version](https://badge.fury.io/js/reactive-graphql.svg)](https://badge.fury.io/js/reactive-graphql) [![Build Status](https://travis-ci.org/mesosphere/reactive-graphql.svg?branch=master)](https://travis-ci.org/mesosphere/reactive-graphql)

Execute GraphQL queries against reactive resolvers (resolvers that return Observable) to get a reactive results.

## Install

```
$ npm i reactive-graphql --save
```

## Usage

The usage is very similar to `graphql-js`'s [`graphql`](https://graphql.org/graphql-js/graphql/#graphql) function, except that:

- resolvers can return an Observable
- the result of a query is an Observable

```js
import { graphql } from "reactive-graphql";
import { makeExecutableSchema } from "graphql-tools";
import { timer } from "rxjs";

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
    }
  }
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

const query = `
  query {
    time
  }
`;

const stream = graphql(schema, query);
// stream is an Observable
stream.subscribe(res => console.log(res));
```

outputs

```
{ data: { time: 0 } }
{ data: { time: 1 } }
{ data: { time: 2 } }
{ data: { time: 3 } }
{ data: { time: 4 } }
...
```

## Caveats
GraphQL Subscriptions are not supported (see [issue #27](https://github.com/mesosphere/reactive-graphql/issues/27)) as everything is treated as subscriptions.

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

import { graphql } from "reactive-graphql";

import { makeExecutableSchema } from "graphql-tools";
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

const query = `
  query {
    posts {
      title
      votes
    }
  }
`;

const postStream = graphql(schema, query);
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
