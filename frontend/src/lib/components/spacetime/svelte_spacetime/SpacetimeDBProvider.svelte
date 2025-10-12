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

  // Create the reactive context - the proxy inside will track connection property changes
  const spacetimeContext: SpacetimeDBContext = new SpacetimeDBContext(
    connectionBuilder.build()
  );

  setSpacetimeContext(spacetimeContext);

  onDestroy(() => {
    // Disconnect when component is destroyed
    spacetimeContext.connection.disconnect();
  });
</script>

{@render children()}
