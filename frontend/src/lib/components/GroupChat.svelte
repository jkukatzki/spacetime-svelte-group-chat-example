<script lang="ts">
	import { Card, CardBody, CardHeader, Input, InputGroup, InputGroupText } from "@sveltestrap/sveltestrap";
	import { DbConnectionBuilder, DbConnectionImpl } from "spacetimedb";

    let messages = useTable<DbConnection, Message>('message');

</script>

{#each messages.rows as message}
    <Card>
        <CardHeader>{message.sender}</CardHeader>
        <CardBody>{message.content}</CardBody>
    </Card>
{/each}
<InputGroup>
    <Input placeholder="Type a message..." />
    <InputGroupText>Send</InputGroupText>
</InputGroup>