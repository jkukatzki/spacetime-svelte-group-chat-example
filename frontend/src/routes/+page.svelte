<script>
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_spacetime/SpacetimeDBProvider.svelte";
	import App from "../App.svelte";
	import { DbConnection } from '$lib/components/spacetime/module_bindings';
  let selectedModule = $state('groupchat1');
</script>

<select bind:value={selectedModule}>
  <option value="groupchat1">Module: groupchat1</option>
  <option value="groupchat2">Module: groupchat2</option>
</select>

<SpacetimeDBProvider 
	dbConnection={DbConnection}
	uri="ws://localhost:3000"
	moduleName={selectedModule}
>
		<App/>
</SpacetimeDBProvider>

