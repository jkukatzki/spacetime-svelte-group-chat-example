<script>
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_spacetime/SpacetimeDBProvider.svelte";
	import App from "../App.svelte";
	import { DbConnection } from '$lib/components/spacetime/module_bindings';
</script>

<SpacetimeDBProvider 
	dbConnection={DbConnection}
	uri="ws://localhost:3000"
	moduleName="groupchat"
>
	<div style="display: none">
		<App/>
	</div>
</SpacetimeDBProvider>

<SpacetimeDBProvider 
	dbConnection={DbConnection}
	uri="ws://localhost:3000"
	moduleName="groupchat"
>
	<div>
		<App/>
	</div>
</SpacetimeDBProvider>
