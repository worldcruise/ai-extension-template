function HighlightEngine() {

    var highlightTag = "EM";
    var highlightClassname = "Highlight";
    var skipTags = new RegExp("^(?:SCRIPT|HEAD|NOSCRIPT|STYLE|TEXTAREA)$"); //TEXTAREA

    //var skipClasses = new RegExp("(ui-datepicker)",'gi');
    var SkipSelectors = "";
    
    var wordColor = [];
    var magicRegex = "";
    var magicRegexCS = "";
    var matchRegex = "";
    var matchRegexEditable = "";
    //var replaceRegex="";
    var numberOfHighlights = 0; 
    var highlights = {}; 
    var notifyAnyway= false;
    var highlightMarkers = {};
    var notifyForWords= new Set();
    var RegexConfig={};

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
    
    this.traverseAndHighlight = function(node, printHighlights, inContentEditable, loopNumber) {
        if (!node) return;
    
        /*if (node.nodeType === 1 && (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA')) {
            this.highlightInput(node, loopNumber);
        }*/
    
        if (node.nodeType === Node.ELEMENT_NODE && (skipTags.test(node.nodeName) || node.matches(SkipSelectors))) return;
    
        if (node.shadowRoot) {
            // Process shadow root
            this.applyStylesToShadowRoot(node);
            node.shadowRoot.childNodes.forEach(childNode => {
                this.traverseAndHighlight(childNode, printHighlights, inContentEditable || node.isContentEditable, loopNumber);
            });
        }
    
        if(node.nodeType !== 3) {
            var textContent=node.textContent;
            if(RegexConfig.useMagicRegex && textContent.length<20000) {
                RegexConfig.doMagicRegex?(regs = magicRegex.exec(textContent)):regs=undefined;
                RegexConfig.doMagicRegexCS?(regsCS = magicRegexCS.exec(textContent)):regsCS=undefined;

                var boolContainsShadowRoot=containsShadowRoot(node)
                if(!regs&&!regsCS&&!boolContainsShadowRoot){
                    return;
                }
            }
            
            node.childNodes.forEach(childNode => {
                this.traverseAndHighlight(childNode, printHighlights, inContentEditable || node.isContentEditable, loopNumber);
            });
        }
    
        if (node.nodeType === 3) {
            this.highlightTextNode(node, inContentEditable, loopNumber);
        }
    };

    this.applyStylesToShadowRoot = function(node){
        // add the css classes in the shadow root if not done yet
        if (!node.shadowRoot.querySelector('style[data-stylename="HighlightThisStyles"]')){
            const style = document.createElement('style');
            style.setAttribute('data-stylename', 'HighlightThisStyles')
            style.textContent = CSSStyles;
            node.shadowRoot.appendChild(style);
        }
    }
     
    // Highlighting Method for Input Elements
    this.highlightInput = function(node, loopNumber) {
        var nv = node.value;
        matchingWord=this.findMatchingWord(nv, false);

        if (matchingWord) {
            node.classList.add(highlightClassname,matchingWord.cssClass );
            // Logic to highlight input elements...


            //var classesToRemove=[];
            /*for(var c = 0; c<node.classList.length; c++) {
                if(node.classList[c].indexOf("HLT")==0 &&node.classList[c]!==wordColor[wordfound].ClassName+'-1'){ classesToRemove.push(node.classList[c]);}
            }
            if(classesToRemove.length>0) {classesToRemove.forEach(classtoRemove => node.classList.remove(classtoRemove));}
    */
            /*if(!node.classList.contains(highlightClassname)){
                node.classList.add(highlightClassname);
            }*/
            /*if(!node.classList.contains(wordColor[wordfound].ClassName+'-1')){
                node.classList.add(wordColor[wordfound].ClassName+'-1');
        }*/
        }
    };

    this.findMatchingWord= function(nv, inContentEditable){
        Debug && console.time('execute regex');
        var wordfound = "";

        if(inContentEditable) {
            RegexConfig.doMatchRegexEditable?(regs = matchRegexEditable.exec(nv)):regs=undefined;
            RegexConfig.doMatchRegexEditableCS?(regsCS = matchRegexEditableCS.exec(nv)):regsCS=undefined;
        } 
        else {
            RegexConfig.doMatchRegex?(regs = matchRegex.exec(nv)):regs=undefined;
            RegexConfig.doMatchRegexCS?(regsCS = matchRegexCS.exec(nv)):regsCS=undefined;
        }
        Debug && console.timeEnd('execute regex');

        if(regs&&regsCS){
            if(regs.index>regsCS.index||(regs.index==regsCS.index&&regsCS[0].length>regs[0].length)){regs=regsCS} 
        } else {
            regs=regs||regsCS;
        }

        if (regs) {
            //find back the longest word that matches the found word 
            //TODO: this can be faster
            Debug && console.time('Find longest word');
            for (word in wordColor) {
                let currentWordColor=wordColor[word];

                var pattern = new RegExp(currentWordColor.regex, currentWordColor.matchtoken);
                
                if (word.length > wordfound.length && (currentWordColor.containerSelector=='' || node.parentElement.matches(currentWordColor.containerSelector)) ){
                    if ((!currentWordColor.findBackAgainstContent&&pattern.test(regs[0])) ) {
                        wordfound = word;
                        break;
                    }

                    //check back regexes
                    if (  ((currentWordColor.findBackAgainstContent&&pattern.test(regs.input)))) {
                        regs=pattern.exec(regs.input)
                        wordfound = word;
                        break;
                    }

                }             
            }

            if (wordColor[wordfound] != undefined ) {
                matchingWord=wordColor[wordfound];
                if(matchingWord.notifyOnHighlight) {
                    notifyForWords.add(matchingWord.word);
                    if (matchingWord.notifyFrequency=="2"){
                        notifyAnyway=true;
                    }
                }
                
                                            
                highlightMarkers[numberOfHighlights] = {
                    "word": matchingWord.word
                };
                
                numberOfHighlights += 1;
                return matchingWord;
            }
        }
    };

    // Highlighting Method for Text Nodes
    this.highlightTextNode = function(node, inContentEditable, loopNumber) {
        var nv = node.nodeValue;
        if(nv.trim()!=''){
            if(node.parentElement&&!(node.parentElement.tagName==highlightTag&&node.parentElement.getAttribute(highlightClassname))){
                //if we compare 2 regex's eg Case Sensity / Insensitive. Take the one with the lowest index from the exec, if equal take the longest string in [0]
                //console.log(nv);
                /*Debug && console.time('execute regex');
                
                if(inContentEditable) {
                    RegexConfig.doMatchRegexEditable?(regs = matchRegexEditable.exec(nv)):regs=undefined;
                    RegexConfig.doMatchRegexEditableCS?(regsCS = matchRegexEditableCS.exec(nv)):regsCS=undefined;
                } 
                else {
                    RegexConfig.doMatchRegex?(regs = matchRegex.exec(nv)):regs=undefined;
                    RegexConfig.doMatchRegexCS?(regsCS = matchRegexCS.exec(nv)):regsCS=undefined;
                }
                Debug && console.timeEnd('execute regex');

                if(regs&&regsCS){
                    if(regs.index>regsCS.index||(regs.index==regsCS.index&&regsCS[0].length>regs[0].length)){regs=regsCS} 
                } else {
                    regs=regs||regsCS;
                }

                if (regs) {
                    var wordfound = "";
                    
                    //find back the longest word that matches the found word 
                    //TODO: this can be faster
                    Debug && console.time('Find longest word');
                    for (word in wordColor) {
                        let currentWordColor=wordColor[word];

                        var pattern = new RegExp(currentWordColor.regex, currentWordColor.matchtoken);
                        
                        if (word.length > wordfound.length && (currentWordColor.containerSelector=='' || node.parentElement.matches(currentWordColor.containerSelector)) ){
                            if ((!currentWordColor.findBackAgainstContent&&pattern.test(regs[0])) ) {
                                wordfound = word;
                                break;
                            }

                            //check back regexes
                            if (  ((currentWordColor.findBackAgainstContent&&pattern.test(regs.input)))) {
                                regs=pattern.exec(regs.input)
                                wordfound = word;
                                break;
                            }

                        }

                    }
                    Debug && console.timeEnd('Find longest word');
                    */
                    matchingWord=this.findMatchingWord(nv, inContentEditable);
                    if (matchingWord) {
                        
                        var match = document.createElement(highlightTag);

                        match.classList.add(highlightClassname,matchingWord.cssClass );

                        //  match.className = wordColor[wordfound].cssClass;
                        match.setAttribute(highlightClassname, true);
                        match.appendChild(document.createTextNode(regs[0]));

                        
                        match.setAttribute('HTmatch', matchingWord.word);
                        match.setAttribute('HTloopNumber', loopNumber);
                        
                        if(matchingWord.action.type!=0){
                                match.onclick=function () {
                                clickHandler(this);
                            };
                        }
                        match.style.fontStyle = "inherit";
                        
                        if (!inContentEditable || (inContentEditable && matchingWord.showInEditableFields)) {
                            
                            var after = node.splitText(regs.index);
                            
                            
                            after.nodeValue = after.nodeValue.substring(regs[0].length);
                            node.parentNode.insertBefore(match, after);
                        }
                        

                        //highlights[wordfound] = highlights[wordfound] + 1 || 1;
                        
                    }
                //}
            } 
            else {
                //text was already highlighted
                
                if(node.parentElement && node.parentElement.getAttribute('HTloopNumber')!==loopNumber.toString()) {

                    
                    highlightMarkers[numberOfHighlights] = {
                        "word": node.parentElement.getAttribute('HTmatch')
                    };
                    

                    numberOfHighlights += 1;
                    //highlights[node.parentElement.getAttribute('HTmatch')] = highlights[node.parentElement.getAttribute('HTmatch')] + 1 || 1;
                }
            }              
        }
    };


    // recursively apply word highlighting
    /*this.highlightWords = function (node, printHighlights, inContentEditable, loopNumber) {
        if (node == undefined || !node) return;

        if (node.nodeType==1 && (node.tagName=='INPUT'||node.tagName=='SELECT'||node.tagName=='TEXTAREA')){
            var nv = node.value;

            this.newHighlight(node, nv, false, loopNumber);
            var classesToRemove=[];
            for(var c = 0; c<node.classList.length; c++) {
                if(node.classList[c].indexOf("HLT")==0 &&node.classList[c]!==wordColor[wordfound].ClassName+'-1'){ classesToRemove.push(node.classList[c]);}
            }
            if(classesToRemove.length>0) {classesToRemove.forEach(classtoRemove => node.classList.remove(classtoRemove));}

            if(!node.classList.contains(highlightClassname)){
                node.classList.add(highlightClassname);
            }
            if(!node.classList.contains(wordColor[wordfound].ClassName+'-1')){
                node.classList.add(wordColor[wordfound].ClassName+'-1');
            }

        }


        if (node.nodeType === Node.ELEMENT_NODE && (skipTags.test(node.nodeName)||node.matches(SkipSelectors))) return;

        // check if there is any shadow-root element, if so dive deeper

        if(node.nodeType !== 3){
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
            if(RegexConfig.useMagicRegex && textContent.length<20000 ){

                RegexConfig.doMagicRegex?(regs = magicRegex.exec(textContent)):regs=undefined;

                RegexConfig.doMagicRegexCS?(regsCS = magicRegexCS.exec(textContent)):regsCS=undefined;

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
                    //console.log(nv);
                    Debug && console.time('execute regex');
                    
                    if(inContentEditable) {
                        RegexConfig.doMatchRegexEditable?(regs = matchRegexEditable.exec(nv)):regs=undefined;
                        RegexConfig.doMatchRegexEditableCS?(regsCS = matchRegexEditableCS.exec(nv)):regsCS=undefined;
                    } 
                    else {
                        RegexConfig.doMatchRegex?(regs = matchRegex.exec(nv)):regs=undefined;
                        RegexConfig.doMatchRegexCS?(regsCS = matchRegexCS.exec(nv)):regsCS=undefined;
                    }
                    Debug && console.timeEnd('execute regex');

                    if(regs&&regsCS){
                        if(regs.index>regsCS.index||(regs.index==regsCS.index&&regsCS[0].length>regs[0].length)){regs=regsCS} 
                    } else {
                        regs=regs||regsCS;
                    }

                    if (regs) {
                        var wordfound = "";
                        
                        //find back the longest word that matches the found word 
                        //TODO: this can be faster
                        Debug && console.time('Find longest word');
                        for (word in wordColor) {
                            let currentWordColor=wordColor[word];

                            var pattern = new RegExp(currentWordColor.regex, currentWordColor.matchtoken);
                            
                            if (word.length > wordfound.length && (currentWordColor.containerSelector=='' || node.parentElement.matches(currentWordColor.containerSelector)) ){
                                if ((!currentWordColor.findBackAgainstContent&&pattern.test(regs[0])) ) {
                                    wordfound = word;
                                    break;
                                }
    
                                //check back regexes
                                if (  ((currentWordColor.findBackAgainstContent&&pattern.test(regs.input)))) {
                                    regs=pattern.exec(regs.input)
                                    wordfound = word;
                                    break;
                                }

                            }

                        }
                        Debug && console.timeEnd('Find longest word');
                        
                        if (wordColor[wordfound] != undefined ) {
                            
                            var match = document.createElement(highlightTag);

                            match.classList.add(highlightClassname,wordColor[wordfound].cssClass );

                          //  match.className = wordColor[wordfound].cssClass;
                            match.setAttribute(highlightClassname, true);
                            match.appendChild(document.createTextNode(regs[0]));

                            
                            match.setAttribute('HTmatch', wordColor[wordfound].word);
                            match.setAttribute('HTloopNumber', loopNumber);
                            
                            if(wordColor[wordfound].action.type!=0){
                                    match.onclick=function () {
                                    clickHandler(this);
                                };
                            }
                            match.style.fontStyle = "inherit";
                            
                            if (!inContentEditable || (inContentEditable && wordColor[wordfound].showInEditableFields)) {
                               
                                var after = node.splitText(regs.index);
                               
                               
                                after.nodeValue = after.nodeValue.substring(regs[0].length);
                                node.parentNode.insertBefore(match, after);
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
                            //highlights[wordfound] = highlights[wordfound] + 1 || 1;
                            
                        }
                    }
                } 
                else {
                    //text was already highlighted
                    
                    if(node.parentElement && node.parentElement.getAttribute('HTloopNumber')!==loopNumber.toString()) {

                        
                        highlightMarkers[numberOfHighlights] = {
                            "word": node.parentElement.getAttribute('HTmatch')
                        };
                        

                        numberOfHighlights += 1;
                        //highlights[node.parentElement.getAttribute('HTmatch')] = highlights[node.parentElement.getAttribute('HTmatch')] + 1 || 1;
                    }
                }              
            }
        }
    };*/

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
            this.traverseAndHighlight(document.body, printHighlights, false, loopNumber);
        }  

        //details: highlights,
        return {numberOfHighlights: numberOfHighlights,  markers: highlightMarkers, notify: Array.from(notifyForWords), notifyAnyway: notifyAnyway};
    };

}
