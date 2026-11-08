
/*var observersMap = new Map();
var observersActive = true;*/
var matchCache={};

function HighlightEngine() {

    var V=false;

    var highlightTag = "EM";
    var highlightClassname = "Highlight";
    var skipTags = new RegExp("^(?:SCRIPT|HEAD|NOSCRIPT|STYLE|TEXTAREA)$"); //TEXTAREA

    var SkipSelectors = "";
    
    var wordColor = [];
    var magicRegex = "";
    var magicRegexCS = "";
    var matchRegex = "";
    var matchRegexEditable = "";
    var numberOfHighlights = 0; 
    var highlights = {}; 
    var notifyAnyway= false;
    var highlightMarkers = {};
    var notifyForWords= new Set();
    var RegexConfig={};

    var featureFlagDetectDynamicUpdates=true;

    const Debug=false;
    
    function containsShadowRoot(node) {
        if(node.nodeType !== 1) { return false; }
        const allElements = node.querySelectorAll('*');
    
        for (const element of allElements) {
            if (element.shadowRoot) {
                return true; 
            }
        }
        return false; 
    }



    function getTextUpToFirstHighlight(parentNode, highlightClass) {
        let textContent = '';
        let stop = false;

    
        if (!parentNode||!parentNode.hasChildNodes()) {
            return; // Exit the function if there are no child nodes
          }

        // Convert child nodes to an array to safely iterate and modify the DOM
        const children = Array.from(parentNode.childNodes);
               
        children.forEach(child => {
            if (stop) return;
        
            if (child.nodeType === Node.TEXT_NODE) {
            // If it's a text node, add its text content
            textContent += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.classList.contains(highlightClass)) {
                // If it's an element node with the 'Highlight' class, stop
                stop = true;
            } else {
                // Otherwise, add its text content recursively
                textContent += child.textContent;
            }
            }
        });
        
        return textContent;
    }
    function removeTextFromFirstHighlight(parentNode, highlightClass) {
        let startRemoving = false;
        
        // Convert child nodes to an array to safely iterate and modify the DOM
        if (!parentNode||!parentNode.hasChildNodes()) {
            return; // Exit the function if there are no child nodes
        }
        const children = Array.from(parentNode.childNodes);
        
        children.forEach(child => {
            if (startRemoving || (child.nodeType === Node.ELEMENT_NODE && child.classList.contains(highlightClass))) {
            startRemoving = true;
            parentNode.removeChild(child);
            }
        });

    }

    function hthandleChange(mutationsList, observer) {
        for (const mutation of mutationsList) {
        
        if (mutation.type === 'characterData'/*&&mutation.target.parentElement*/) {
            console.log('The text content of a node has been changed.');
            /*const nativeTextContent= getTextUpToFirstHighlight(mutation.target.parentElement,'Highlight')
            const htOriginalText=mutation.target.parentElement.getAttribute('htoriginaltext')
            console.log('getTextUpToFirstHighlight:', nativeTextContent)
            console.log('textcontent', mutation.target.parentElement.textContent)
            console.log('htOriginalText', htOriginalText)
            //console.log('element:', mutation.target.parentElement.innerHTML)
            if(nativeTextContent==htOriginalText){
                console.log('removing')
                removeTextFromFirstHighlight(mutation.target.parentElement,'Highlight')
                //console.log('element:', mutation.target.parentElement.innerHTML)
            }*/
            const t=mutation.target
            //V=false
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
const observer = new MutationObserver(hthandleChange);

// Configuration of the observer
const htObserverConfig = {childList: true, subtree: true, characterData: true };


     
    // recursively apply word highlighting
    this.highlightWords = function (node, printHighlights, inContentEditable, loopNumber) {
        
        if (node == undefined || !node) return;

        if (node.nodeType === Node.ELEMENT_NODE && (skipTags.test(node.nodeName)||node.matches(SkipSelectors))) {
            
            return;
        }
        // check if there is any shadow-root element, if so dive deeper
       

        if (node.nodeName == highlightTag && node.classList.contains(highlightClassname)){
            //text was already highlighted
            //console.log("skip highlighting",node)
            if(node.getAttribute('htloopNumber')!==loopNumber.toString()) {
                highlightMarkers[numberOfHighlights] = {
                    "word": node.getAttribute('htmatch')
                };

                numberOfHighlights += 1;
            }
            return
        }     

        if(node.nodeType !== 3 /*&& node.nodeName !== highlightTag && !node.classList.contains(highlightClassname)*/){
            
            if(node.shadowRoot){
                
                if (!node.shadowRoot.querySelector('style[data-stylename="HighlightThisStyles"]')){
                    const style = document.createElement('style');
                    style.setAttribute('data-stylename', 'HighlightThisStyles')
                    style.textContent = CSSStyles;
                    node.shadowRoot.appendChild(style);
                }

                for (const childNode of node.shadowRoot.childNodes) {
                    this.highlightWords(childNode, printHighlights, inContentEditable || node.isContentEditable, loopNumber);
                }

            }
            var textContent=node.textContent;

            if(RegexConfig.useMagicRegex && textContent.length<5000 ){
                //console.time("inUseMagicRegex")
                //console.log("text length",textContent.length)
                RegexConfig.doMagicRegex?(regs = magicRegex.exec(textContent)):regs=undefined;
                RegexConfig.doMagicRegexCS?(regsCS = magicRegexCS.exec(textContent)):regsCS=undefined;
                //console.timeEnd("inUseMagicRegex")
                var boolContainsShadowRoot=containsShadowRoot(node)
                
                if(!regs&&!regsCS&&!boolContainsShadowRoot){
                    return;
                }
            }
            
            for (const childNode of node.childNodes) {
                this.highlightWords(childNode, printHighlights, inContentEditable || node.isContentEditable, loopNumber);
            }

        }

        
        if (node.nodeType == 3) {
            //only act on text nodes
            
            var nv = node.nodeValue;
            if(nv.trim()!=''){
                if(node.parentElement&&!(node.parentElement.tagName==highlightTag&&node.parentElement.getAttribute(highlightClassname))){
                    //if we compare 2 regex's eg Case Sensity / Insensitive. Take the one with the lowest index from the exec, if equal take the longest string in [0]

                  
                        if(inContentEditable) {
                            RegexConfig.doMatchRegexEditable?(regs = matchRegexEditable.exec(nv)):regs=undefined;
                            RegexConfig.doMatchRegexEditableCS?(regsCS = matchRegexEditableCS.exec(nv)):regsCS=undefined;
                        } 
                        else {
                            RegexConfig.doMatchRegex?(regs = matchRegex.exec(nv)):regs=undefined;
                            RegexConfig.doMatchRegexCS?(regsCS = matchRegexCS.exec(nv)):regsCS=undefined;
                        }
                  
                        if(regs&&regsCS){
                            if(regs.index>regsCS.index||(regs.index==regsCS.index&& regsCS[1] && regs[1]&&regsCS[1].length>regs[1].length)){regs=regsCS} 
                        } else {
                            regs=regs||regsCS;
                        }
                        
    
                        if (regs) {
                            var wordfound = "";

                            if(regs[1]){
                                regResult=regs[1];
                                startIndex=regs.index+regs[0].indexOf(regs[1]);
                            }
                            else{
                                regResult=regs[0];
                                startIndex=regs.index;
                            }
                                  
                            // Check the cache first if speed optimized performance is on
                            if (RegexConfig.useMagicRegex&&matchCache.hasOwnProperty(regResult)) {
                                wordfound = matchCache[regResult];
                            }
                            else {
                                //find back the longest word that matches the found word 
                                for (word in wordColor) {
                                    let currentWordColor=wordColor[word];

                                    if ((currentWordColor.regexTokens || regResult.length>=currentWordColor.wordLengthForCompare) &&  (currentWordColor.containerSelector=='' || node.parentElement.matches(currentWordColor.containerSelector)) ){
                                        var pattern = currentWordColor.compiledRegex ;
                                        if ((!currentWordColor.findBackAgainstContent && pattern.test(regResult)) ) {
                                            wordfound = word;
                                            if(!currentWordColor.nocache){
                                                matchCache[regResult] = wordfound;
                                            }
                                            break;
                                        }
            
                                        //check back regexes
                                        if (  ((currentWordColor.findBackAgainstContent &&pattern.test(regs.input)))) {
                                            regsRegex=pattern.exec(regs.input);
                                            if(regsRegex[0]==regs[0]){
                                                regResult=regs[0];
                                                startIndex=regs.index;
                                                wordfound = word;
                                                break;
                                            }

                                        }
                                    }
                                }
                            }
      

                            if (wordColor[wordfound] != undefined ) {

                                if (!inContentEditable || (inContentEditable && wordColor[wordfound].showInEditableFields)) {    
                                    try {
                                        var match = document.createElement(highlightTag);

                                        // the flex control does not work eg on https://www.ebay.com/sch/i.html?_from=R40&_nkw=tire&_sacat=0&_odkw=tire&_osacat=0 
                                        // highlight the word "tire" with a container filter on ".x-refine__item__title-container"
                                        // it breaks teh clicking in the facet title
                                        
                                        if (window.getComputedStyle(node.parentElement).display === 'flex') {
                                            var newSpan = document.createElement('span');
                                            newSpan.textContent=node.textContent;
                                            node.parentElement.replaceChild(newSpan, node);
                                            node=newSpan.childNodes[0];
                                        } 


                                        match.classList.add(highlightClassname,wordColor[wordfound].cssClass );

                                        match.setAttribute(highlightClassname, true);
                                        match.setAttribute('htmatch', wordColor[wordfound].word);
                                        match.setAttribute('htloopnumber', loopNumber);
                                        match.style.fontStyle = "inherit";
                                        
                                        if(wordColor[wordfound].action.type!=0){
                                                match.onclick=function () {
                                                clickHandler(this);
                                            };
                                        }
                                                                

                                        // Split the text node at the start of the capturing group match
                                    
                                            //observersActive=false;
                                        
                                        if (featureFlagDetectDynamicUpdates){
                                            //node.parentElement.setAttribute('htOriginalText', node.textContent)
                                            // Start observing the parent element
                                            observer.observe(node, htObserverConfig);
                                        }
                                        V=true;
                                        var matchStart = node.splitText(startIndex);
                                        

                                        // Split the 'matchStart' node at the end of the capturing group match, isolating it in its own node
                                        var matchEnd = matchStart.splitText(regResult.length);

                                        // Create the new element to wrap the capturing group match
                                        //matchStart.parentNode.replaceChild(match, matchStart);
                                        //match.textContent = matchStart.nodeValue; // Set the capturing group match as the content of the new element
                                        matchStart.parentNode.appendChild(match)
                                        matchStart.remove()
                                            //featureFlagDetectDynamicUpdates && match.setAttribute('htTextAfter',matchEnd.length);

                                        // Replace the matched text node with the new element
                                        //matchStart=match
                                        
                                        
                                        V=false;


                                            //observersActive=true;
                                            //featureFlagDetectDynamicUpdates && this.observeHighlightElement(node.parentNode);
                                    }
                                    catch (error) {
                                        // Manually report the error to window.onerror
                                        if (window.onerror) {
                                            
                                            const message = (error.message || "An error occurred") + "-[" + regs + "]-" + window.location;
                                            const source = error.fileName || "unknown file"; // Note: error.fileName is non-standard
                                            const lineno = error.lineNumber || 0; // Note: error.lineNumber is non-standard
                                            const colno = error.columnNumber || 0; // Note: error.columnNumber is non-standard
                                            window.onerror(message, source, lineno, colno, error);
                                        } else {
                                            // Fallback error handling if window.onerror is not available
                                            console.error(error);
                                            storeError('an error occured during highlighting', 'HighlightEngine', 0, 0, error)
                                        }
                                        return true;
                                    }
                                }
                                
                                if(wordColor[wordfound].notifyOnHighlight) {
                                    notifyForWords.add(wordColor[wordfound].word);
                                    if (wordColor[wordfound].notifyFrequency=="2"){
                                        notifyAnyway=true;
                                    }
                                }
                                                                                        
                                highlightMarkers[numberOfHighlights] = {
                                    "word": wordColor[wordfound].word
                                };
                                
                                numberOfHighlights += 1; 
                            }
                        }
                    
                } 
            }
        }
    };


    // start highlighting at target node
    this.highlight = function (words, printHighlights, regexConfig, skipSelectors, loopNumber) {
        wordColor = words;
        numberOfHighlights = 0;


            RegexConfig=regexConfig;

            matchRegex = new RegExp(regexConfig.matchRegex,"i");
            matchRegexCS = new RegExp(regexConfig.matchRegexCS,"");
            matchRegexEditable = new RegExp(regexConfig.matchRegexEditable,"i");
            matchRegexEditableCS = new RegExp(regexConfig.matchRegexEditableCS,"");
    
            magicRegex = new RegExp(regexConfig.magicRegex,"i");
            magicRegexCS = new RegExp(regexConfig.magicRegexCS,"");

        SkipSelectors = skipSelectors;

        if (matchRegex||matchRegexCS) {
            //console.time('run')
            this.highlightWords(document.body, printHighlights, false, loopNumber);
            //console.timeEnd('run')
        }  

        return {numberOfHighlights: numberOfHighlights,  markers: highlightMarkers, notify: Array.from(notifyForWords), notifyAnyway: notifyAnyway};
    };

}
