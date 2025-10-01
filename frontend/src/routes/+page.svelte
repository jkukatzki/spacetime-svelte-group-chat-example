<script>
	import { DbConnection } from "$lib/components/spacetime/module_bindings";
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_context/SpacetimeDBProvider.svelte";
    import App from "../App.svelte";
    
    const connectionBuilder = DbConnection.builder()
        .withUri('ws://192.168.178.103:3000')
        .withModuleName('groupchat');
</script>
<SpacetimeDBProvider {connectionBuilder}>
    <App/>
</SpacetimeDBProvider>