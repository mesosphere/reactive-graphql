# Reactive GraphQL

This project aims to become a complete GraphQL implementation based around [RxJS](https://github.com/ReactiveX/rxjs).

## Usage Example [![Edit](https://codesandbox.io/static/img/play-codesandbox.svg)](https://codesandbox.io/s/github/DanielMSchmidt/reactive-graphql-demo/tree/master/?hidenavigation=1)

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

## Unsupported features

- fragments of all kinds
- subscriptions (as everything is treated as a subscription)
- only one top-level operation is supported

## API

The 1st argument you pass into `reactive-graphql` is an executable schema, the 2nd one a GraphQL query, either parsed or as string. You can pass in the root value as 3rd and the root context as an object as 4th parameter. The variables can be passed as 5th parameter.

The implementation will always return an Observable.
If any of the resolvers returns an error the implementation will emit the error on the stream.
Otherwise the data will be wrapped in a `{ data }` object, like most implementations handle this.

## License

Apache 2.0
