# Reactive GraphQL

This project aims to become a complete GraphQL implementation based around [RxJS](https://github.com/ReactiveX/rxjs).

## API

```js
import graphql from "reactive-graphql";

import { makeExecutableSchema } from "graphql-tools";
import gql from "graphql-tag";

const schema = makeExecutableSchema(...);
const query = gql`
    query {
        myNormalQuery
    }`

const dataStream = graphql(query, schema);
dataStream.subscribe(console.log);

```

## Unsupported features

- fragments of all kinds
- subscriptions (as everything is treated as a subscription)
