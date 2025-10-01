<script lang="ts">
	import { Button, Card, CardBody, CardHeader, Col, Container, Input, InputGroup, InputGroupText, Modal, Row } from "@sveltestrap/sveltestrap";
	import { DbConnectionBuilder, DbConnectionImpl } from "spacetimedb";
	import { createReactiveTable, type ReactiveTable } from "./spacetime/svelte_context/getReactiveTable.svelte";
	import { DbConnection, GroupChat, Message, SendMessage, User } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { onDestroy } from "svelte";

    let spacetimeContext = getSpacetimeContext<DbConnection>();

    // Create reactive tables declaratively - they automatically get context and connect when ready
    let groupChatsTable: ReactiveTable<GroupChat> = createReactiveTable<GroupChat>('groupchat', {
        onInsert: (chat) => console.log('New group chat created:', chat.id),
        onDelete: (chat) => console.log('Group chat deleted:', chat.id)
    });

    let messagesTable: ReactiveTable<Message> = createReactiveTable<Message>('message', {
        onInsert: (message) => console.log('New message received:', message.text),
        onUpdate: (oldMessage, newMessage) => console.log('Message updated:', newMessage.text),
        onDelete: (message) => console.log('Message deleted:', message.text)
    });

    let usersTable: ReactiveTable<User> = createReactiveTable<User>('user', {
        onInsert: (user) => console.log('New user joined:', user.name),
        onDelete: (user) => console.log('User left:', user.name)
    });

    // Simple connection ready state derived from any table being ready
    let connectionReady = $derived(
        groupChatsTable.state === 'ready' || 
        messagesTable.state === 'ready' || 
        usersTable.state === 'ready'
    );
    
    // Clean up reactive tables when component is destroyed
    onDestroy(() => {
        groupChatsTable.destroy();
        messagesTable.destroy();
        usersTable.destroy();
    });

    let createGroupChatModalOpen = $state(false);
    let createGroupChatName = $state("");
    

    let input = $state("");

    const sendMessage = () => {
        if (!spacetimeContext.connection) {
            console.error("No connection available");
            return;
        }
        if (input.trim() === "") {
            return;
        }
        spacetimeContext.connection.reducers.sendMessage(input);
        input = ""; // Clear input after sending
    }

</script>

{#if spacetimeContext.connection}
    <Container>
        <!-- Connection Status Bar -->
        <div class="connection-status {connectionReady ? 'ready' : 'connecting'}">
            {#if connectionReady}
                🟢 Connected to SpacetimeDB
            {:else}
                🟡 Connecting to SpacetimeDB...
            {/if}
        </div>
        
        <Row>
            <Col xs="3">
                <!-- GROUP CHATS -->
                
                {#if connectionReady && groupChatsTable.rows !== undefined}
                    <Row>
                        
                    </Row>
                    <Button onclick={() => createGroupChatModalOpen = true} disabled={!connectionReady}>New Chat</Button>
                    <Modal body header="Create Group Chat" isOpen={createGroupChatModalOpen} toggle={() => createGroupChatModalOpen = !createGroupChatModalOpen}>
                        <Input placeholder="Group Chat Name" bind:value={createGroupChatName} />
                        <Button onclick={() => {
                            if (spacetimeContext.connection && createGroupChatName.trim() !== "" && connectionReady) {
                                spacetimeContext.connection.reducers.createGroupchat(createGroupChatName);
                                createGroupChatName = "";
                                createGroupChatModalOpen = false;
                            }
                        }}>Create</Button>
                    </Modal>
                    {#each groupChatsTable.rows as chat}
                        <Row class="my-2">
                            <Button onclick={() => spacetimeContext.connection?.reducers.joinGroupchat(chat.id)}>
                                {chat.id}
                            </Button>
                        </Row>
                        
                    {/each}
                {:else}
                    <h3>{connectionReady ? 'Loading group chats...' : 'Waiting for connection...'}</h3>
                {/if}
            </Col>
            <!-- MESSAGES -->
            <Col xs="6">
                <div class="chat-header">
                    <h5>Messages ({messagesTable.state === 'ready' ? 'Connected' : 'Loading...'})</h5>
                    <small>Total: {messagesTable.rows?.length ?? 0} messages</small>
                </div>
                {#if messagesTable.rows !== undefined}
                    {#each messagesTable.rows as message}
                        <Card class="mb-2">
                            <CardHeader>{message.sender}:</CardHeader>
                            <CardBody>{message.text}</CardBody>
                        </Card>
                    {/each}
                {:else}
                    <Card>
                        <CardBody>Loading messages...</CardBody>
                    </Card>
                {/if}
            </Col>
        </Row>
    </Container>

    <InputGroup class="fixed-bottom w-50 mx-auto">
        <Input placeholder="Type a message..." bind:value={input} onkeydown={(e) => e.key === 'Enter' && sendMessage()} disabled={!connectionReady} />
        <Button onclick={sendMessage} disabled={!connectionReady}>Send</Button>
    </InputGroup>
{:else}
    <p>Connecting to SpacetimeDB...</p>
{/if}