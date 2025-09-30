<script lang="ts">
  import { setContext, onMount, onDestroy, type Snippet } from 'svelte';
  import type { DbConnectionBuilder, DbConnectionImpl } from 'spacetimedb';
  import { SPACETIMEDB_CONTEXT_KEY, type SpacetimeDBContext } from './useSpacetimeDB.svelte';
  
  interface Props<
    DbConnection extends DbConnectionImpl,
    ErrorContext,
    SubscriptionEventContext,
  > {
    connectionBuilder: DbConnectionBuilder<
      DbConnection,
      ErrorContext,
      SubscriptionEventContext
    >;
    children: Snippet;
  }

  let { 
    connectionBuilder,
    children
  }: Props<any, any, any> = $props();

  let connection: DbConnectionImpl | undefined = $state(undefined);
  let connected = $state(false);
  let error: Error | undefined = $state(undefined);

  // Create context value following the useThrelte pattern
  const contextValue: SpacetimeDBContext = {
    getConnection: () => connection,
    connected: {
      get current() { return connected; }
    },
    error: {
      get current() { return error; }
    }
  };

  // Set the context for child components IMMEDIATELY (not in onMount)
  setContext(SPACETIMEDB_CONTEXT_KEY, contextValue);

  onMount(() => {
    try {
      // Build the connection when component mounts
      connection = connectionBuilder.build();
      
      // Set up connection event handlers if available
      const clientWithEvents = connection as any;
      if (clientWithEvents.onConnect) {
        clientWithEvents.onConnect(() => {
          connected = true;
          error = undefined;
        });
      }
      
      if (clientWithEvents.onDisconnect) {
        clientWithEvents.onDisconnect(() => {
          connected = false;
        });
      }
      
      if (clientWithEvents.onConnectError) {
        clientWithEvents.onConnectError((err: Error) => {
          connected = false;
          error = err;
        });
      }
    } catch (err) {
      error = err as Error;
      console.error('Failed to create SpacetimeDB connection:', err);
    }
  });

  onDestroy(() => {
    // Connection will clean itself up automatically when component is destroyed
    connected = false;
    connection = undefined;
  });
</script>

{@render children()}
