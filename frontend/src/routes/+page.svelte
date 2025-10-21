<script>
	import SpacetimeDBProvider from "$lib/components/spacetime/svelte_spacetime/SpacetimeDBProvider.svelte";
	import App from "../App.svelte";
	import { DbConnection } from '$lib/components/spacetime/module_bindings';
  let selectedModule = $state('groupchat1');
  let url = $state('ws://localhost');
  let port = $state(3000);
</script>

<select bind:value={selectedModule}>
  <option value="groupchat1">Module: groupchat1</option>
  <option value="groupchat2">Module: groupchat2</option>
</select>
<input bind:value={url}/>
<input type="number" bind:value={port}/>

<div style="display: flex">
  <div>
    <SpacetimeDBProvider 
    dbConnection={DbConnection}
    uri={url + ':' + port}
    moduleName={'groupchat1'}>
		  <App/>
    </SpacetimeDBProvider>
  </div>
  <div>
    <SpacetimeDBProvider 
      dbConnection={DbConnection}
      uri={url + ':' + port}
      moduleName={'groupchat2'}>
        <App/>
    </SpacetimeDBProvider>
  </div>
</div>



