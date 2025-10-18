<script>
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_spacetime/SpacetimeDBProvider.svelte";
    import { connectionBuilder } from "$lib/spacetimeConnectionBuilder";
    import App from "../App.svelte";
</script>
<SpacetimeDBProvider {connectionBuilder}>
    <App/>
</SpacetimeDBProvider>
