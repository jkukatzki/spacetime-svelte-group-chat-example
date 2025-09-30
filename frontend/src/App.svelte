<script lang="ts">
    import GroupChat from "$lib/components/GroupChat.svelte";
    import SpacetimeDBProvider from "$lib/components/spacetime/svelte_context/SpacetimeDBProvider.svelte";
    import { DbConnection } from "$lib/components/spacetime/module_bindings/index"
	import { Styles } from "@sveltestrap/sveltestrap";

    const connectionBuilder = DbConnection.builder()
        .withUri('ws://localhost:3000')
        .withModuleName('groupchat');
</script>

<Styles/>
<SpacetimeDBProvider {connectionBuilder}>
    <GroupChat/>
</SpacetimeDBProvider>