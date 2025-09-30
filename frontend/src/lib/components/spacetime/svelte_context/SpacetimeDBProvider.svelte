<script lang="ts">
  import { setContext, onMount, onDestroy, type Snippet } from 'svelte';
  import type { DbConnectionBuilder, DbConnectionImpl } from 'spacetimedb';
	import { SPACETIMEDB_CONTEXT_KEY, SpacetimeDBContext } from '../SpacetimeContext.svelte';
  
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

  const spacetimeContext: SpacetimeDBContext = new SpacetimeDBContext(
    undefined,
    undefined,
  );

  // Set the context for child components IMMEDIATELY (not in onMount)
  setContext(SPACETIMEDB_CONTEXT_KEY, spacetimeContext);

  onMount(() => {
    try {
      // Build the connection when component mounts
      spacetimeContext.connection = connectionBuilder.build();
      
      // Set up connection event handlers if available
      const clientWithEvents = spacetimeContext.connection as any;
      if (clientWithEvents.onConnect) {
        clientWithEvents.onConnect(() => {
          spacetimeContext.connected = true;
          spacetimeContext.error = undefined;
        });
      }
      
      if (clientWithEvents.onDisconnect) {
        clientWithEvents.onDisconnect(() => {
          spacetimeContext.connected = false;
        });
      }
      
      if (clientWithEvents.onConnectError) {
        clientWithEvents.onConnectError((err: Error) => {
          spacetimeContext.connected = false;
          spacetimeContext.error = err;
        });
      }
    } catch (err) {
      spacetimeContext.error = err as Error;
      console.error('Failed to create SpacetimeDB connection:', err);
    }
  });

  onDestroy(() => {
    // Connection will clean itself up automatically when component is destroyed
    spacetimeContext.connected = false;
    spacetimeContext.connection = undefined;
  });
</script>

{@render children()}
