<script>
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_spacetime/SpacetimeDBProvider.svelte";    import App from "../App.svelte";

    import { DbConnection } from '$lib/components/spacetime/module_bindings';

// Singleton builder so every provider instance shares the same configuration reference.
 const connectionBuilder = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withModuleName('groupchat');
  const connectionBuilder2 = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withModuleName('xxx');

</script>
<SpacetimeDBProvider {connectionBuilder} moduleName="groupchat">
  <div style="display: none">
    <App/>
  </div>

</SpacetimeDBProvider>
<SpacetimeDBProvider connectionBuilder={connectionBuilder2} moduleName="groupchat">
  <div>
    <App/>
  </div>

</SpacetimeDBProvider>
