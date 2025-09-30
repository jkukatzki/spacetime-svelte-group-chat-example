<script lang="ts">
	import { Button, Card, CardBody, CardHeader, Col, Container, Input, InputGroup, InputGroupText, Modal, Row } from "@sveltestrap/sveltestrap";
	import { DbConnectionBuilder, DbConnectionImpl } from "spacetimedb";
	import { createReactiveTable, type ReactiveTable } from "./spacetime/svelte_context/getReactiveTable.svelte";
	import { DbConnection, GroupChat, Message, SendMessage, User } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { onDestroy } from "svelte";

    let groupChatsTable: ReactiveTable<GroupChat> | undefined = $state();
    let messagesTable: ReactiveTable<Message> | undefined = $state();
    let spacetimeContext = getSpacetimeContext<DbConnection>();
    let users = $state();
    
    $effect(() => {
        if (spacetimeContext.connection) {
            // Create reactive tables with proper event handling
            messagesTable = createReactiveTable<Message>('message', {
                onInsert: (message) => console.log('New message received:', message.text),
                onUpdate: (oldMessage, newMessage) => console.log('Message updated:', newMessage.text),
                onDelete: (message) => console.log('Message deleted:', message.text)
            });
            
            groupChatsTable = createReactiveTable<GroupChat>('groupchat', {
                onInsert: (chat) => console.log('New group chat created:', chat.id),
                onDelete: (chat) => console.log('Group chat deleted:', chat.id)
            });
        }
    });

    // Clean up reactive tables when component is destroyed
    onDestroy(() => {
        messagesTable?.destroy();
        groupChatsTable?.destroy();
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
        <Row>
            <Col xs="3">
                <Button onclick={() => createGroupChatModalOpen = true}>New Chat</Button>
                <Modal body header="Create Group Chat" isOpen={createGroupChatModalOpen} toggle={() => createGroupChatModalOpen = !createGroupChatModalOpen}>
                    <Input placeholder="Group Chat Name" bind:value={createGroupChatName} />
                    <Button onclick={() => {
                        if (spacetimeContext.connection && createGroupChatName.trim() !== "") {
                            spacetimeContext.connection.reducers.createGroupchat(createGroupChatName);
                            createGroupChatName = "";
                            createGroupChatModalOpen = false;
                        }
                    }}>Create</Button>
                </Modal>
                {#if groupChatsTable?.rows}
                    {#each groupChatsTable.rows as chat}
                        <Button onclick={() => spacetimeContext.connection?.reducers.joinGroupchat(chat.id)}>{chat.id}</Button>
                    {/each}
                {:else}
                    <Input type="select" disabled>
                        <option>Loading group chats...</option>
                    </Input>
                {/if}
            </Col>
            <Col xs="6">
                <div class="chat-header">
                    <h5>Messages ({messagesTable?.state === 'ready' ? 'Connected' : 'Loading...'})</h5>
                    <small>Total: {messagesTable?.rows?.length ?? 0} messages</small>
                </div>
                {#if messagesTable?.rows}
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
        <Input placeholder="Type a message..." bind:value={input} onkeydown={(e) => e.key === 'Enter' && sendMessage()} />
        <Button onclick={sendMessage}>Send</Button>
    </InputGroup>
{:else}
    <p>Connecting to SpacetimeDB...</p>
{/if}

<style>
    .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding: 0.5rem;
        background-color: #f8f9fa;
        border-radius: 0.25rem;
    }
    
    .chat-header h5 {
        margin: 0;
    }
    
    .chat-header small {
        color: #6c757d;
    }
</style>