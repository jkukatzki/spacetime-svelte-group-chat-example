import { DbConnection } from '$lib/components/spacetime/module_bindings';

// Singleton builder so every provider instance shares the same configuration reference.
export const connectionBuilder = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withModuleName('groupchat');
