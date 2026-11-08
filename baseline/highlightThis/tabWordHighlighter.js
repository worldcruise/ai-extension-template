var HighlightsData={};
var Settings=skipSelectorsForUrl(window.location.href);

var wordsArray = [];
var wordsForBox = [];
var regexConfig={};
var wordsForBoxRegex={};
var skipSelectors='';
var ReadyToFindWords = true; //indicates if not in a highlight execution
var Debug = false;
var DebugStats={findCount:0, loopCount:0, subTreeModCount:0};
var highlightMarkers={};

var nrFoundWords=0;
var nrFoundWordsInFields=0;

var CSSStyles='';

// Apply the saved rendering mode to every open frame, not just the active tab.
chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.Settings &&
        (changes.Settings.oldValue?.rangeHighlighting === true) !==
        (changes.Settings.newValue?.rangeHighlighting === true)) {
        reHighlight();
    }
});

function storeError(message, source, lineno, colno, error){
    chrome.storage.session.get({ errors: [] }, function (data) {
        const { errors } = data;
    
        // Add the new error to the existing errors array
        const errorStack = error ? error.stack : '';
        const errorEntry = { 
          message,  // shorthand for message: message
          source,   // shorthand for source: source
          line: lineno, 
          col: colno, 
          error: errorStack
        };
        

        errors.push(errorEntry);
    
        const maxErrorsToKeep = 50;
        const errorsToStore = errors.slice(-maxErrorsToKeep);

        // Store the updated errors array back in chrome.storage.session
        chrome.storage.session.set({ errors: errorsToStore }, function () {
          if (chrome.runtime.lastError) {
            console.error("Error storing errors:", chrome.runtime.lastError);
          } else {
            console.log("Error stored successfully.");
          }
        });
    });
}
window.onerror = function (message, source, lineno, colno, error) {
    console.error("Error occurred:", message);
    console.error("Source:", source);
    console.error("Line:", lineno);
    console.error("Column:", colno);
    console.error("Error object:", error);
    // Optionally, you can send this information to a logging server or do additional error handling.
    storeError(message, source, lineno, colno, error);
    return true; // Prevents the default browser error handling (e.g., showing an error dialog).
};


Debug && console.info('starting highlighter');

var Config={
    decreaseLoop: 125,
    fixedLoopTime: false,
    highlightLoopFrequency: 500,
    increaseLoop: 0,
    maxLoopTime: 2500,
    minLoopTime: 500,
    updateOnDomChange: true
}


var licensed=true;

var HighlightPending=true; // indicates if the extension needs to highlight at start or due to a change. This is evaluated in a loop
var HighlightLoopFrequency=1000; // the frequency of checking if a highlight needs to occur
//var HighlightWarmup=300; // min time to wait before running a highlight execution

var HighlightLoop;

var alreadyNotified = false;

var highlighterEnabled = true;

var markerCurrentPosition = -1;
//var markerPositions = [];
var highlightMarkers = {};
var markerScroll = false;
var printHighlights = true;




function getData(callback){
    Promise.all([
        new Promise((resolve, reject) => chrome.storage.local.get( result => resolve(result))),
        new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
      ]).then(([localData, syncData]) => {
        Settings=localData.Settings;
        setLoopConfig();
        const combinedData = Object.assign({}, localData, syncData);
        delete combinedData.Settings;
        HighlightsData=combinedData;
        //console.log('get words for', location.href)
        var groupsForUrl=getGroupsForUrl(Settings, HighlightsData, location.href.replace(location.protocol + "//", ""));
        wordsForUrl=getWords(groupsForUrl, location.href.replace(location.protocol + "//", ""),Settings.license.type, Settings.magicHighlighting==undefined?true:Settings.magicHighlighting);
        
        wordsArray=wordsForUrl.words;
        regexConfig=wordsForUrl.regex;

        wordsForBox=wordsForUrl.wordsForBox;
        wordsForBoxRegex= wordsForUrl.wordsForBoxRegex;
        
        skipSelectors=wordsForUrl.skipSelectors;

        Debug&&console.log('processed words');
        wordsReceived = true;
        callback();
      }).catch(error => {
        console.error('error retrieving data', error);
    });
}

function filterGroupsForContextMenu(groups) {
    var result=[];
    for (var element in groups) {
        if(groups[element].type!=='remote') {
            result.push({'id': element, 'name': groups[element].name,'modified': groups[element].modified})
        }
    }
    result.sort(
        function(a, b) {
            return b.modified - a.modified
        }
    );
    return result
}

// Let the page render before the first scan: >=500ms after DOM readiness,
// 300ms without relevant text mutations, but no more than 2000ms of waiting.
// Settings must also be available. This gate applies only to startup.
var HighlightStartupReady = false;
var HighlightDataReady = false;
var HighlightDocumentReady = document.readyState === 'complete' ||
    (document.readyState !== 'loading' && performance.getEntriesByType('navigation')[0]?.domContentLoadedEventStart > 0);
var HighlightStartupTimer;
var HighlightStartupObserver;
var HighlightStartupAt;
var HighlightStartupLastChange;
function startupMutationHasText(record) {
    const ignored = 'head,script,style,noscript,textarea,em.Highlight[Highlight]';
    const parent = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (parent?.closest(ignored)) return false;
    if (record.type === 'characterData') return !!(record.target.data.trim() || record.oldValue?.trim());
    return [...record.addedNodes, ...record.removedNodes].some(node => {
        if (node.nodeType === Node.TEXT_NODE) return !!node.data.trim();
        if (node.nodeType !== Node.ELEMENT_NODE || node.matches(ignored)) return false;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(child) {
                if (child.nodeType === Node.ELEMENT_NODE) return child.matches(ignored) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
                return child.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        return !!walker.nextNode();
    });
}
function scheduleHighlightStartup() {
    if (!HighlightDocumentReady || document.readyState === 'loading' || HighlightStartupReady) return;
    if (HighlightStartupAt === undefined) {
        HighlightStartupAt = HighlightStartupLastChange = performance.now();
        HighlightStartupObserver = new MutationObserver(records => {
            if (records.some(startupMutationHasText)) {
                HighlightStartupLastChange = performance.now();
                scheduleHighlightStartup();
            }
        });
        HighlightStartupObserver.observe(document, { childList: true, characterData: true,
            characterDataOldValue: true, subtree: true });
    }
    clearTimeout(HighlightStartupTimer);
    HighlightStartupTimer = undefined;
    if (!HighlightDataReady) return;
    const due = Math.min(HighlightStartupAt + 2000,
        Math.max(HighlightStartupAt + 500, HighlightStartupLastChange + 300));
    HighlightStartupTimer = setTimeout(function () {
        HighlightStartupTimer = undefined;
        HighlightStartupObserver.disconnect();
        HighlightStartupObserver = undefined;
        HighlightStartupReady = true;
        HighlightPending = true;
        if (wordsForBox.length > 0) highlightFields(wordsForBox, wordsForBoxRegex, null, skipSelectors);
        highlightLoop();
    }, Math.max(0, due - performance.now()));
}
getData(function(){
    HighlightDataReady = true;
    scheduleHighlightStartup();
    if (Settings.enabled) {
        //update context menu
        updateMenu()
    }   
});


function updateMenu(){
    var groupsForUrl=getGroupsForUrl(Settings, HighlightsData, location.href.replace(location.protocol + "//", ""));
    chrome.runtime.sendMessage({
        command: "updateContextMenu",
        url: location.href.replace(location.protocol + "//", ""),
        groups: filterGroupsForContextMenu(groupsForUrl)
    }, function (response) {
        Debug&&console.log('updated menu');
    });
}

//message listener

if(window.location == window.parent.location){
    //only listen for messages in the main page, not in iframes since they load the extension too
    chrome.runtime.onMessage.addListener(
        function (request, sender, sendResponse) {
            Debug && console.log("got a message", request);
            if (sender.id==chrome.runtime.id){
                if (request.command == "ScrollHighlight") {
                    jumpToNextElementWithClass();
                    return false
                }
                if (request.command == "getMarkers") {
                    sendResponse(highlightMarkers);
                    return true;
                }
                if (request.command == "ClearHighlights") {
                    reHighlight();
                    updateMenu();
                    //setClassesinPage(groupsList, licenseType)

                    //highlightMarkers = {};
                    return false;

                }
                if (request.command == "reHighlight") {
                    reHighlight();
                    updateMenu();
                    return false;
                }
                if (request.command == "tabActivated") {
                    updateMenu();
                    reHighlight();
                    sendResponse();
                    return true;
                }
                if(request.command == 'urlChanged'){
                    //console.log('url changed' , request.url)
                    reHighlight();
                    return true;
                }
            }
            return true;
        }
    );
}
else {
    Debug&&console.log("not in main page",window.location)
}



function reHighlight() {
    Debug&&console.log('rehighlight');

    const previousWords = wordsArray;
    const previousRegex = regexConfig;
    const renderKey = () => JSON.stringify([wordsArray, Object.fromEntries(Object.entries(regexConfig).filter(([key]) => key !== "removeStrings")), skipSelectors, CSSStyles,
        Settings.enabled, Settings.rangeHighlighting, Settings.performanceSetting]);
    const previousKey = renderKey();
    getData(function(){
        if (previousKey !== renderKey()) {
            HighlightThisRenderer.clear();
        } else {
            // Navigation/tab focus need not tear down identical highlights.
            wordsArray = previousWords;
            regexConfig = previousRegex;
        }
        HighlightPending=true;
        if (Settings.enabled) {
            //trigger the highlight loop
            if(HighlightStartupReady && wordsForBox.length>0){
                myFieldsHilighter.highlightFields(wordsForBox,wordsForBoxRegex, null,skipSelectors)
            };
        }   
    });
}

var myFieldsHilighter = new HighlightFieldsEngine();



function onHighlightDocumentReady() {
    HighlightDocumentReady = true;
    scheduleHighlightStartup();
    document.body?.addEventListener('change', function(event) {
        // Check if the event was fired from an input or textarea element
        if (HighlightStartupReady&&wordsForBox.length>0&&(event.target.tagName === 'INPUT'||event.target.tagName === 'TEXTAREA')) {
            highlightFields(wordsForBox,wordsForBoxRegex,event.target,skipSelectors)
            //console.log('Input value changed in element with ID:', event.target.id, 'New value:', event.target.value);
        }
    });
    

}
if (!HighlightDocumentReady) {
    document.addEventListener('DOMContentLoaded', onHighlightDocumentReady, { once: true });
} else {
    onHighlightDocumentReady();
}



function highlightLoop(){

    ReadyToFindWords = true;
    Debug&&console.log("in loop",DebugStats);
    if(HighlightPending){
        findWords(); 
        if(!Config.fixedLoopTime&&HighlightLoopFrequency<Config.maxLoopTime){
            HighlightLoopFrequency+=Config.increaseLoop;
        }
    }
        //calucate new HighlightLoopFrequency


    else{
        if(!Config.fixedLoopTime&&HighlightLoopFrequency>Config.minLoopTime){
            HighlightLoopFrequency-=Config.decreaseLoop;
        } 
    }

    Debug&&(DebugStats.loopCount+=1);
    Debug&&console.log("new loop frequency",HighlightLoopFrequency);

    HighlightLoop = setTimeout(function () {
        highlightLoop();
    }, HighlightLoopFrequency);
}

function highlightFields(wordsForBox,wordsForBoxRegex, eventTarget,skipSelectors)
{
    var highlights =myFieldsHilighter.highlightFields(wordsForBox,wordsForBoxRegex,eventTarget,skipSelectors)

    if (highlights.numberOfHighlights > 0) {
        nrFoundWordsInFields = highlights.numberOfHighlights;

        if(window.location == window.parent.location) {
            chrome.runtime.sendMessage({
                command: "showHighlights",
                count: (nrFoundWordsInFields+nrFoundWords),
                url: document.location.href
            }, function (response) {
            });
        }

        if((!alreadyNotified | highlights.notifyAnyway)& highlights.notify.length>0){
            alreadyNotified=true;
            var notificationWords=''; 
            for (var notification in highlights.notify){
                notificationWords+=(highlights.notify[notification])+', ';
            }
            chrome.runtime.sendMessage({
                command: "notifyOnHighlight", forced: highlights.notifyAnyway
            }, function (response) {});
        }
    }
}

function findWords() {
    if (!HighlightStartupReady || document.readyState === 'loading') {
        HighlightPending = true;
        return;
    }
    HighlightPending=false;

    Debug&&console.log('finding words',window.location);

    ReadyToFindWords=false;
    
    var changed = false;
    var myHilighter = new HighlightEngine();

    regexConfig.removeStrings="";
    
    var loopNumber=Math.floor(Math.random() * 1000000000);
    Debug&&console.time('tab-highlight');
    var highlights = myHilighter.highlight(Settings.enabled ? wordsArray : [], printHighlights, regexConfig, skipSelectors, loopNumber);
    Debug&&console.timeEnd('tab-highlight');
    //console.log(highlights)
    if (highlights.numberOfHighlights > 0) {
        Debug&&console.log('highglights:', highlights.numberOfHighlights)
        nrFoundWords=highlights.numberOfHighlights;
        highlightMarkers = highlights.markers;

        if(window.location == window.parent.location) {
            chrome.runtime.sendMessage({
                command: "showHighlights",
                count: nrFoundWordsInFields+nrFoundWords,
                url: document.location.href
            }, function (response) {
            });
        }

        if((!alreadyNotified | highlights.notifyAnyway)& highlights.notify.length>0){
            alreadyNotified=true;
            var notificationWords=''; 
            for (var notification in highlights.notify){
                notificationWords+=(highlights.notify[notification])+', ';
            }
            chrome.runtime.sendMessage({
                command: "notifyOnHighlight", forced: highlights.notifyAnyway
            }, function (response) {});
        }
    }
    else {
        nrFoundWords=0;
        highlightMarkers={};
        if(window.location == window.parent.location) {
            chrome.runtime.sendMessage({ command: "showHighlights", count: nrFoundWordsInFields, url: document.location.href }, function () {});
        }
    }
    Debug&&console.log('finished finding words');
    Debug&&(DebugStats.findCount+=1);

    ReadyToFindWords = true;

}


function globStringToRegex(str) {
    return preg_quote(str).replace(/\\\*/g, '\\S*').replace(/\\\?/g, '.');
}

function preg_quote (str,delimiter) {
    // http://kevin.vanzonneveld.net
    // +   original by: booeyOH
    // +   improved by: Ates Goral (http://magnetiq.com)
    // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +   bugfixed by: Onno Marsman
    // +   improved by: Brett Zamir (http://brett-zamir.me)
    // *     example 1: preg_quote("$40");
    // *     returns 1: '\$40'
    // *     example 2: preg_quote("*RRRING* Hello?");
    // *     returns 2: '\*RRRING\* Hello\?'
    // *     example 3: preg_quote("\\.+*?[^]$(){}=!<>|:");
    // *     returns 3: '\\\.\+\*\?\[\^\]\$\(\)\{\}\=\!\<\>\|\:'
    return (str + '').replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]', 'g'), '\\$&'); 
    //return str;
}

function clickHandler(e, wordConfig, matchedText){

    try {
        var match=wordConfig ? wordConfig.word : e.getAttribute('HTmatch');
        //find my word
        wordConfig=wordConfig || wordsArray.find(word => word.word==match);
        
        if (wordConfig){
            if (['1', '2', '3'].includes(wordConfig.action.type)) {
                //replace tokens
                var url=constructActionUrl(wordConfig.action.actionLink, (matchedText === undefined ? e.innerText : matchedText), match);
                          
                if (wordConfig.action.type==1) {window.open(url);}
                if (wordConfig.action.type==2) {window.open(url,'_self');}
                if (wordConfig.action.type==3) {
                    chrome.runtime.sendMessage({
                        command: "openUrlInNewWindow",
                        url: url
                    });
                }
            }

        }
    }
    catch(c){

    }

}







function matchesPattern(hostname, pattern) {
    const regex = new RegExp(pattern, "i");
    return regex.test(hostname);
}




function jumpToNextElementWithClass() {
    HighlightThisRenderer.jumpToNext();
}


  function setLoopConfig(){
    if(Settings.performanceSetting) {
        if(Settings.performanceSetting==100){
            Config= {
                highlightLoopFrequency: 250,
                decreaseLoop: 50,
                minLoopTime: 250,
                fixedLoopTime: false,
                updateOnDomChange: true
            };
            return;
        }
        if(Settings.performanceSetting==300){ 
            Config=  {
                highlightLoopFrequency: 1000,
                fixedLoopTime: false,
                increaseLoop: 500,
                decreaseLoop: 100,
                maxLoopTime: 2500,
                minLoopTime: 1000,
                updateOnDomChange: true
            };
            return;
        }
        if(Settings.performanceSetting==400){ 
            // no ajax support, only highlights when doc loaded
            Config=  {
                highlightLoopFrequency: 1000,
                fixedLoopTime: false,
                increaseLoop: 4000,
                decreaseLoop: 0,
                maxLoopTime: 5000,
                minLoopTime: 1000,
                updateOnDomChange: false
            };
            return;
        }
    }
    Config=  {
        decreaseLoop: 125,
        fixedLoopTime: false,
        highlightLoopFrequency: 500,
        increaseLoop: 0,
        maxLoopTime: 2500,
        minLoopTime: 500,
        updateOnDomChange: true
    };

}

function skipSelectorsForUrl(inUrl){
    //the datepicker component acts weird on changing text content
    var skipSelectors=['.ui-datepicker'];

    if(inUrl.indexOf('calendar.google.com')>-1){
        //google calendar loses text that is highlighed and all text behind it in elements with role button
        skipSelectors.push('[role="button"]');
    }
    if(inUrl.indexOf('linkedin.com')>-1){
        //linked in messenger duplicates data
        skipSelectors.push('code');
        skipSelectors.push('.msg-s-message-list-container');
        skipSelectors.push('.jobs-unified-top-card__job-title');
    }

    if(inUrl.indexOf('reddit.com')){
        skipSelectors.push('.header-user-dropdown');
        
    }
    return skipSelectors.join(', ');
}
