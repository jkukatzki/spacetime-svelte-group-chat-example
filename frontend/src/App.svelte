<script lang="ts">
	import { Badge, Button, Card, CardBody, CardHeader, Col, Container, Input, InputGroup, Modal, Row, Styles, Toast, ToastBody, ToastHeader } from "@sveltestrap/sveltestrap";
	import { STQuery, and, eq, not, or, where } from "./lib/components/spacetime/svelte_spacetime";
	import { DbConnection, GroupChat, GroupChatMembership, Message, User } from "./lib/components/spacetime/module_bindings";
	import { getSpacetimeContext } from "./lib/components/spacetime/svelte_spacetime/SpacetimeContext.svelte";

    let spacetimeContext = getSpacetimeContext<DbConnection>();
    let users: STQuery<DbConnection, User> = new STQuery<DbConnection, User>('user');
    let clientUserTable = new STQuery<DbConnection, User>('user', where(eq('identity', spacetimeContext.connection.identity)));
    let clientMemberships = new STQuery<DbConnection, GroupChatMembership>('groupchatMembership', where(eq('identity', spacetimeContext.connection.identity)));
    
    // Derive the specific user from the table's rows
    let clientUser: User | undefined = $derived(clientUserTable.rows[0]);

    let selectedGroupChat: GroupChat | undefined = $derived.by(() => {
        if (clientMemberships.rows.length > 0) {
            // Auto-selecting group chat based on new membership
            return groupChats.rows?.find(chat => chat.id === clientMemberships.rows[clientMemberships.rows.length - 1].groupchatId);
        }
    });
    
    let groupChats = new STQuery<DbConnection, GroupChat>('groupchat');
    let groupChatMessages = $derived(
        !selectedGroupChat ? null :
        new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat.id)))
    );
    let groupChatMembers = $derived(
        !selectedGroupChat ? null :
        new STQuery<DbConnection, GroupChatMembership>('groupchatMembership',
            where(
                and(
                    eq('groupchatId', selectedGroupChat.id),
                    not(eq('identity', spacetimeContext.connection.identity))
                )
            )
        )
    );

    // establish a query for incoming messages in all
    // group chats we are part of except the one we're currently viewing
    let clientPushMessages = $derived(
        !clientMemberships.rows.length ? null :
        new STQuery<DbConnection, Message>('message',
            where(or(...clientMemberships.rows.filter(m => m.groupchatId != selectedGroupChat?.id).map(m => eq('groupchatId', m.groupchatId))))
        )
    );
    // add callbacks to the clientPushMessages query to display toast message
    $effect(() => {
        if (clientPushMessages) {
            clientPushMessages.events.onInsert((newRow) => {
                const senderUser = users.rows.find(user => user.identity.isEqual(newRow.sender));
                if (senderUser) {
                    messageToast.isOpen = true;
                    messageToast.senderUser = senderUser;
                    messageToast.message = newRow;
                }
            });
        }
    });

    let createGroupChatModalOpen = $state(false);
    let createGroupChatName = $state("");
    let changeNameModalOpen = $state(false);
    let newName = $state("");

    let messageInput = $state("");
    
    // Scroll management for messages
    let messagesContainer: HTMLDivElement | undefined = $state();
    function isScrolledToBottom(element: HTMLDivElement): boolean {
        return element.scrollHeight - element.scrollTop - element.clientHeight < 10;
    }
    function scrollToBottom() {
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    // Check scroll position BEFORE DOM updates
    $effect.pre(() => {
        if (groupChatMessages?.rows && messagesContainer) {
            if (isScrolledToBottom(messagesContainer)) {
                // If already at bottom, prepare to scroll after update
                requestAnimationFrame(() => scrollToBottom());
            }
        }
    });
    
    // Auto-scroll when selecting a new group chat
    $effect(() => {
        if (selectedGroupChat && messagesContainer) {
            // Always scroll to bottom when changing chats
            requestAnimationFrame(() => scrollToBottom());
        }
    });

    const sendMessage = () => {
        if (!spacetimeContext.connection) {
            console.error("No connection available");
            return;
        }
        if (messageInput.trim() === "") {
            return;
        }
        if (!selectedGroupChat) {
            console.error("No groupchat selected");
            return;
        }
        spacetimeContext.connection.reducers.sendMessage(selectedGroupChat.id, messageInput);
        messageInput = ""; // Clear input after sending
    }

    class MessageToast {
        isOpen = $state(false);
        message: Message = $state({} as Message);
        senderUser: User = $state({} as User);
    }

    const messageToast = new MessageToast();

</script>

<Styles/>
{#if spacetimeContext.connection}
    <Container fluid>
        <Row class="gx-2 p-3 vh-100">
            <Col xs="2" class="h-100">
                <div class="d-flex flex-column p-1 border rounded h-100">
                    <div class="mb-1 flex-shrink-0">{spacetimeContext.connection.identity ? "🟢 Connected" : "🟡 Connecting"}</div>
                    <!-- GROUP CHAT SELECTION -->
                    {#if groupChats.rows !== undefined}
                        <Button class="mb-3 flex-shrink-0" color="primary" onclick={() => createGroupChatModalOpen = true} disabled={!spacetimeContext.connected}>
                            Create group chat +
                            <Modal body header="Create Group Chat" isOpen={createGroupChatModalOpen} toggle={() => createGroupChatModalOpen = !createGroupChatModalOpen}>
                                <Input placeholder="Group Chat Name" bind:value={createGroupChatName} />
                                <Button class="mt-3" onclick={() => {
                                    if (createGroupChatName.trim() !== "") {
                                        spacetimeContext.connection.reducers.createGroupchat(createGroupChatName);
                                        createGroupChatName = "";
                                        createGroupChatModalOpen = false;
                                    }
                                }}>Create</Button>
                            </Modal>
                        </Button>
                        
                        <h4 class="flex-shrink-0">My Groups:</h4>
                        <div class="flex-grow-1 overflow-auto">
                            {#each groupChats.rows.filter(chat => clientMemberships.rows.some(m => m.groupchatId === chat.id)) as chat}
                                <div class="my-1">
                                    <Button class="w-100" outline={selectedGroupChat !== chat} onclick={() => {selectedGroupChat = chat}}>
                                        {chat.id}
                                    </Button>
                                </div>
                            {:else}
                                <p class="text-muted ms-1 mb-3">Not a member of any groups.</p>
                            {/each}
                        </div>
                        <h4 class="flex-shrink-0">Available Groups:</h4>
                        <div class="flex-grow-1 overflow-auto">
                            {#each groupChats.rows.filter(chat => !clientMemberships.rows.some(m => m.groupchatId === chat.id)) as chat}
                                <div class="my-1">
                                    <Button class="w-100" outline={selectedGroupChat !== chat} onclick={() => {selectedGroupChat = chat}}>
                                        {chat.id}
                                    </Button>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <h3>{spacetimeContext.connected ? 'Loading group chats...' : 'Waiting for connection...'}</h3>
                    {/if}
                </div>
            </Col>
            <!-- GROUP CHAT -->
            <Col xs="7" class="h-100">
                <div class="d-flex flex-column border rounded p-3 h-100">
                    <!-- HEADER -->
                    {#if selectedGroupChat}
                        <div class="flex-shrink-0">
                            <h4>Group Chat {selectedGroupChat.id}</h4>
                            {#if clientMemberships.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
                                {#if groupChatMessages?.rows !== undefined}
                                    <div class="chat-header mb-3">
                                        <small>Total: {groupChatMessages?.rows.length ?? '/'} messages</small>
                                    </div>
                                {/if}
                            {/if}
                        </div>
                        {#if clientMemberships.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
                            {#if groupChatMessages?.rows !== undefined}
                                <!-- MESSAGES AND MESSAGE INPUT -->
                                <div class="d-flex flex-column flex-grow-1" style="min-height: 0;">
                                    <div class="flex-grow-1 overflow-auto mb-3" bind:this={messagesContainer}>
                                        {#each groupChatMessages?.rows as message}
                                            <Card class="mb-2">
                                                <CardHeader>{users.rows.find(u => u.identity.toHexString() === message.sender.toHexString())?.name ?? message.sender.toHexString().slice(-6)} <small class="float-left fs-7 text-muted">at {new Date(message.sent.toDate()).toLocaleTimeString()}</small></CardHeader>
                                                <CardBody>{message.text}</CardBody>
                                            </Card>
                                        {/each}
                                    </div>
                                    <div class="flex-shrink-0">
                                        <InputGroup>
                                            <Input placeholder="Type a message..." bind:value={messageInput} onkeydown={(e) => e.key === 'Enter' && sendMessage()} disabled={!spacetimeContext.connected} />
                                            <Button onclick={sendMessage} disabled={!spacetimeContext.connected}>Send</Button>
                                        </InputGroup>
                                    </div>
                                </div>
                            {:else}
                                <Card>
                                    <CardBody>Loading messages...</CardBody>
                                </Card>
                            {/if}
                        {:else}
                            <h5>You are not a member of this group chat.</h5>
                            <Button color="primary" class="mb-2" onclick={() => {
                                if (spacetimeContext.connection && selectedGroupChat) {
                                    spacetimeContext.connection.reducers.joinGroupchat(selectedGroupChat.id);
                                }
                            }}>Join Chat</Button>
                        {/if}
                    {:else}
                        <h3>Select a group chat!</h3>
                    {/if}
                </div>
            </Col>
            <!-- USERS -->
            <Col xs="3" class="h-100">
                <div class="border rounded p-3 h-100">
                    {#if clientUser}
                    <Card class="border-primary">
                        <CardHeader>
                            <h6>Connected as:</h6>
                            <h6>{clientUser.name ? clientUser.name : "..."+clientUser.identity.toHexString().slice(-10)}</h6>
                            <Button onclick={() => changeNameModalOpen = true} size="sm" color="secondary">Change Name</Button>
                            <Modal body header="Change Display Name" isOpen={changeNameModalOpen} toggle={() => changeNameModalOpen = !changeNameModalOpen}>
                                <Input placeholder="New Display Name" bind:value={newName} />
                                <Button class="mt-3" onclick={() => {
                                    if (newName.trim() !== "") {
                                        spacetimeContext.connection.reducers.setName(newName);
                                        newName = "";
                                        changeNameModalOpen = false;
                                    }
                                }}>Save</Button>
                            </Modal>
                        </CardHeader>
                    </Card>
                    {/if}
                    {#if groupChatMembers?.rows && groupChatMembers.rows.length > 0}
                        <h6 class="mt-3">Users in this group chat (excluding yourself):</h6>
                        {#each groupChatMembers.rows as membership}
                            <div class="ms-2">
                                {#if users}
                                    <Badge 
                                        pill={true}
                                        color={['primary', 'danger', 'success', 'warning'][membership.identity.toHexString().charCodeAt(0) % 4]}
                                        class="me-1">
                                        {users.rows.find(u => u.identity.toHexString() === membership.identity.toHexString())?.name ?? (membership.identity.toHexString().slice(-6))}
                                    </Badge>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                    <h6 class="mt-3">All Users:</h6>
                    {#if users}
                        <div class="ms-2">
                            {#each users.rows ?? [] as user}
                                <Badge 
                                    pill={true}
                                    color={['primary', 'danger', 'success', 'warning'][user.identity.toHexString().charCodeAt(0) % 4]}
                                    class="me-1"
                                >
                                    {user.name ?? user.identity.toHexString().slice(-6)}
                                </Badge>
                            {/each}
                        </div>
                    {/if}
                </div>
            </Col>
        </Row>
    </Container>
{:else}
    <p>Connecting to SpacetimeDB...</p>
{/if}

<!-- MESSAGE TOAST -->
<div class="position-fixed bottom-0 end-0 p-3 z-3">
    <Toast
        autohide
        style="cursor: pointer"
        isOpen={messageToast.isOpen}
        on:close={() => (messageToast.isOpen = false)}
        onclick={() => (selectedGroupChat = groupChats.rows.find(chat => chat.id === messageToast.message.groupchatId))}
    >
        <ToastHeader>{messageToast.senderUser.name ?? messageToast.message.sender.toHexString().slice(-6)} in {messageToast.message.groupchatId}:</ToastHeader>
        <ToastBody>
            {`${messageToast.message.text}`}
        </ToastBody>
    </Toast>
</div>
