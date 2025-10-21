<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import type { DbConnectionBuilder, DbConnectionImpl } from 'spacetimedb';
	import { SpacetimeDBContext, setSpacetimeContext } from './SpacetimeContext.svelte';
  
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

  // Global module-level storage for singleton connection management
  // This persists across component instances and prevents double connections during hydration
  const GLOBAL_CONNECTION_SYMBOL = Symbol.for('spacetime:global_connection');
  const GLOBAL_REFCOUNT_SYMBOL = Symbol.for('spacetime:global_refcount');
  const GLOBAL_DISCONNECT_TIMER_SYMBOL = Symbol.for('spacetime:global_disconnect_timer');
  const GLOBAL_BUILDING_SYMBOL = Symbol.for('spacetime:global_building');

  type ConnectionType = ReturnType<(typeof connectionBuilder)['build']>;
  type GlobalConnectionStore = {
    [GLOBAL_CONNECTION_SYMBOL]?: ConnectionType;
    [GLOBAL_REFCOUNT_SYMBOL]?: number;
    [GLOBAL_DISCONNECT_TIMER_SYMBOL]?: ReturnType<typeof setTimeout>;
    [GLOBAL_BUILDING_SYMBOL]?: boolean;
  };

  // Use globalThis to ensure true cross-module singleton
  const globalStore = (globalThis as any) as GlobalConnectionStore;

  // Always start with undefined connection to prevent double connections during SSR hydration
  // The real connection will be built in onMount after hydration is complete
  const spacetimeContext: SpacetimeDBContext = new SpacetimeDBContext();

  setSpacetimeContext(spacetimeContext);

  onMount(() => {
    // Delay connection building to ensure hydration is complete
    // This prevents double connections when SSR rehydrates
    const timeoutId = setTimeout(() => {
      // Prevent concurrent connection building using global flag
      if (globalStore[GLOBAL_BUILDING_SYMBOL]) {
        // Another instance is already building, wait for it
        const checkInterval = setInterval(() => {
          const existingConnection = globalStore[GLOBAL_CONNECTION_SYMBOL];
          if (existingConnection && !globalStore[GLOBAL_BUILDING_SYMBOL]) {
            clearInterval(checkInterval);
            globalStore[GLOBAL_REFCOUNT_SYMBOL] = (globalStore[GLOBAL_REFCOUNT_SYMBOL] ?? 0) + 1;
            spacetimeContext.initializeConnection(existingConnection);
          }
        }, 10);
        return;
      }

      if (globalStore[GLOBAL_DISCONNECT_TIMER_SYMBOL]) {
        clearTimeout(globalStore[GLOBAL_DISCONNECT_TIMER_SYMBOL]);
        globalStore[GLOBAL_DISCONNECT_TIMER_SYMBOL] = undefined;
      }

      let connection = globalStore[GLOBAL_CONNECTION_SYMBOL];
      if (!connection) {
        // Set building flag to prevent concurrent builds
        globalStore[GLOBAL_BUILDING_SYMBOL] = true;
        connection = connectionBuilder.build();
        globalStore[GLOBAL_CONNECTION_SYMBOL] = connection;
        globalStore[GLOBAL_REFCOUNT_SYMBOL] = 0;
        globalStore[GLOBAL_BUILDING_SYMBOL] = false;
      }

      globalStore[GLOBAL_REFCOUNT_SYMBOL] = (globalStore[GLOBAL_REFCOUNT_SYMBOL] ?? 0) + 1;

      // Initialize the context with the connection
      spacetimeContext.initializeConnection(connection);
      
      // Set up connection event handlers to update reactive state
      const clientWithEvents = connection as any;
      if (clientWithEvents.onConnect) {
        clientWithEvents.onConnect(() => {
          console.log('onConnect fired');
          console.log('Connection object keys:', Object.keys(connection));
          console.log('Connection object own property names:', Object.getOwnPropertyNames(connection));
          
          // SpacetimeDB might be storing the identity in various ways
          // Let's check all possible locations
          const possibleIdentities = [
            (connection as any).__identity__,
            (connection as any)._identity,
            clientWithEvents.__identity__,
            clientWithEvents._identity
          ];
          
          console.log('Possible identities:', possibleIdentities);
          
          // Find the actual identity
          const actualIdentity = possibleIdentities.find(id => id !== undefined);
          console.log('Using identity:', actualIdentity);
          
          if (actualIdentity) {
            // Directly update the reactive state
            spacetimeContext.connection.identity = actualIdentity;
          }
          spacetimeContext.connection.isActive = true;
        });
      }
      
      if (clientWithEvents.onDisconnect) {
        clientWithEvents.onDisconnect(() => {
          spacetimeContext.connection.isActive = false;
        });
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  });

  onDestroy(() => {
    // Only manage connection lifecycle on the client
    if (browser && spacetimeContext.connection) {
      globalStore[GLOBAL_REFCOUNT_SYMBOL] = (globalStore[GLOBAL_REFCOUNT_SYMBOL] ?? 1) - 1;
      if (globalStore[GLOBAL_REFCOUNT_SYMBOL] <= 0) {
        globalStore[GLOBAL_DISCONNECT_TIMER_SYMBOL] = setTimeout(() => {
          const conn = globalStore[GLOBAL_CONNECTION_SYMBOL];
          if (conn) {
            conn.disconnect();
          }
          delete globalStore[GLOBAL_CONNECTION_SYMBOL];
          delete globalStore[GLOBAL_REFCOUNT_SYMBOL];
          delete globalStore[GLOBAL_DISCONNECT_TIMER_SYMBOL];
        }, 0);
      }
    }
  });
</script>

{@render children()}
