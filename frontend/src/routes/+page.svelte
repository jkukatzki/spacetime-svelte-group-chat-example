<script>
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_spacetime/SpacetimeDBProvider.svelte";    import App from "../App.svelte";

    import { DbConnection } from '$lib/components/spacetime/module_bindings';

// Singleton builder so every provider instance shares the same configuration reference.
export const connectionBuilder = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withModuleName('groupchat');

</script>
<SpacetimeDBProvider {connectionBuilder}>
    <App/>
</SpacetimeDBProvider>
