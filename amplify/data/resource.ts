import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  UserPreference: a
    .model({
      key: a.string().required(),
      value: a.string().required(),
    })
    .authorization((allow) => [allow.owner()]),

  UserNote: a
    .model({
      title: a.string().required(),
      content: a.string(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
