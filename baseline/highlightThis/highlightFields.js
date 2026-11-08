function HighlightFieldsEngine() {
    
    var wordColor = [];
    var matchRegex = "";
    var matchRegexCS = "";
    var RegexConfig={};
    var notifyForWords= new Set();
    var numberOfHighlights = 0; 
    var notifyAnyway= false;

    this.highlightField=function(targetElement){
        nv=targetElement.value;

        if(nv&&nv.trim()!==''){

            RegexConfig.doMatchRegex?(regs = matchRegex.exec(nv)):regs=undefined;
            RegexConfig.doMatchRegexCS?(regsCS = matchRegexCS.exec(nv)):regsCS=undefined;

            if(regs&&regsCS){
                if(regs.index>regsCS.index||(regs.index==regsCS.index&&regsCS[0].length>regs[0].length)){regs=regsCS} 
            } else {
                regs=regs||regsCS;
            }
            if(regs){
                var wordfound = "";
                //something was found
                for (word in wordColor) {
                    let currentWordColor=wordColor[word];

                    var pattern = new RegExp(currentWordColor.regex, currentWordColor.matchtoken);
                    
                    if (word.length > wordfound.length && (currentWordColor.containerSelector=='' || targetElement.closest(currentWordColor.containerSelector)) ){
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
                    var highlightClassname='HighlightThis';
                    matchingWord=wordColor[wordfound];
                    
                    for(var c = 0; c<targetElement.classList.length; c++) {
                        if(targetElement.classList[c].indexOf("ht")==0 &&targetElement.classList[c].indexOf("-box")>-1 && targetElement.classList[c]!==matchingWord.cssClass){ targetElement.classList.remove(targetElement.classList[c]);}
                    }
                    targetElement.classList.add(highlightClassname,matchingWord.cssClass );
                
                    if(matchingWord.notifyOnHighlight) {
                        notifyForWords.add(matchingWord.word);
                        if (matchingWord.notifyFrequency=="2"){
                            notifyAnyway=true;
                        }
                    }
                    numberOfHighlights += 1;

                }


            }
            else {
                //remove all HLT classes
                for(var c = 0; c<targetElement.classList.length; c++) {
                    if(targetElement.classList[c].indexOf("ht")==0 &&targetElement.classList[c].indexOf("-box")>-1){ targetElement.classList.remove(targetElement.classList[c]);}
                }
            }
        }
    }

    this.highlightFields = function (words, regexConfig, targetElement, skipSelectors) {
        wordColor = words;
        RegexConfig=regexConfig;

        matchRegex = new RegExp(regexConfig.matchRegex,"i");
        matchRegexCS = new RegExp(regexConfig.matchRegexCS,"");

        if(!targetElement){
            document.querySelectorAll('input, textarea').forEach((e) => {
                this.highlightField(e);
            });
        }
        else {
            this.highlightField(targetElement);
        }
        return {numberOfHighlights: numberOfHighlights,  notify: Array.from(notifyForWords), notifyAnyway: notifyAnyway};


    }
}