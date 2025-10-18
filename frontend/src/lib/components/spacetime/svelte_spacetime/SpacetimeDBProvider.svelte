<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
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

  const CONNECTION_SYMBOL = Symbol.for('spacetime:connection');
  const REFCOUNT_SYMBOL = Symbol.for('spacetime:connection_refcount');
  const DISCONNECT_TIMER_SYMBOL = Symbol.for('spacetime:disconnect_timer');

  type ConnectionType = ReturnType<(typeof connectionBuilder)['build']>;
  type CachedBuilder = typeof connectionBuilder & {
    [CONNECTION_SYMBOL]?: ConnectionType;
    [REFCOUNT_SYMBOL]?: number;
    [DISCONNECT_TIMER_SYMBOL]?: ReturnType<typeof setTimeout>;
  };
  const builderWithCache = connectionBuilder as CachedBuilder;

  if (builderWithCache[DISCONNECT_TIMER_SYMBOL]) {
    clearTimeout(builderWithCache[DISCONNECT_TIMER_SYMBOL]);
    builderWithCache[DISCONNECT_TIMER_SYMBOL] = undefined;
  }

  let connection = builderWithCache[CONNECTION_SYMBOL];
  if (!connection) {
    connection = connectionBuilder.build();
    builderWithCache[CONNECTION_SYMBOL] = connection;
    builderWithCache[REFCOUNT_SYMBOL] = 0;
  }

  builderWithCache[REFCOUNT_SYMBOL] = (builderWithCache[REFCOUNT_SYMBOL] ?? 0) + 1;

  // Create the reactive context - the proxy inside will track connection property changes
  const spacetimeContext: SpacetimeDBContext = new SpacetimeDBContext(connection);

  setSpacetimeContext(spacetimeContext);

  onDestroy(() => {
    builderWithCache[REFCOUNT_SYMBOL] = (builderWithCache[REFCOUNT_SYMBOL] ?? 1) - 1;
    if (builderWithCache[REFCOUNT_SYMBOL] <= 0) {
      builderWithCache[DISCONNECT_TIMER_SYMBOL] = setTimeout(() => {
        spacetimeContext.connection.disconnect();
        delete builderWithCache[CONNECTION_SYMBOL];
        delete builderWithCache[REFCOUNT_SYMBOL];
        delete builderWithCache[DISCONNECT_TIMER_SYMBOL];
      }, 0);
    }
  });
</script>

{@render children()}
