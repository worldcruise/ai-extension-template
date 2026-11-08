function hthandleChange(mutationsList, observer) {
    for (const mutation of mutationsList) {
    
        if (mutation.type === 'characterData'/*&&mutation.target.parentElement*/) {
            console.log('The text content of a node has been changed.');

            const t=mutation.target

            if(t.nextSibling){
                console.log(t)
                if (!V && t instanceof Text && t.textContent && t.nextSibling?.className.startsWith(highlightClassname))
                    do {
                        t.nextSibling?.remove()
                    } while (t.nextSibling instanceof Text);
                
            }
            

        }
    }
}

// Create an instance of MutationObserver
const htobserver = new MutationObserver(hthandleChange);

// Configuration of the observer
const htObserverConfig = {childList: true, subtree: true, characterData: true };

htel=document.querySelector(".test-id__field-label")
node=htel.childNodes[0]
//htobserver.observe(htel, htObserverConfig);

startIndex=5;

let match = document.createElement('em');
match.style.backgroundColor = "red";

let matchStart = node.splitText(startIndex);
let matchEnd = matchStart.splitText(5);
matchStart.parentNode.replaceChild(match, matchStart);
match.textContent = matchStart.nodeValue;