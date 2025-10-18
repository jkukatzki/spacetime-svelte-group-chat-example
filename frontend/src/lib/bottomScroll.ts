function isScrolledToBottom(element: HTMLDivElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 10;
}
function scrollToBottom(container: HTMLDivElement) {
    container.scrollTop = container.scrollHeight;
}
export function bottomScroll(container: HTMLDivElement, onlyIfAlreadyAtBottom: boolean = true) {
    if (!onlyIfAlreadyAtBottom || isScrolledToBottom(container)) {
        // If already at bottom, prepare to scroll after update
        requestAnimationFrame(() => scrollToBottom(container));
    }
}