import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { initBlocks } from './blocks.js';

export const backend = defineBackend({ auth, data });

await initBlocks(backend);
