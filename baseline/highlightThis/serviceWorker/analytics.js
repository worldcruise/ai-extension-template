const analyticsEndpoint='https://api.highlightthis.net/api/analyticsService';

export function sendAnalytics(reason){
    var analyticsObject = {
        version: chrome.runtime.getManifest().version,
        reason: reason,
        numberOfLocalGroups: 0,
        numberOfSyncGroups: 0,
        numberOfWords: 0,
        useDetectCompleteWords: false,
        useDetectPartialWords: false,
        useOfRegex: false,
        useOfCaseSensitive: false,
        useOfNotifications: false,
        useOfActions: false,
        useOfInclusionRules: false,
        useOfExclusionRules: false,
        useOfGeneralExclusionRules: false,
        sourceFromWeb: false,
        sourceFromSheets: false,
        sourceFromPastebin: false,
        browser: getBrowser(),
        language: navigator.language,
        magicHighlighting: false
    };
    
    // get general analytics
    
    Promise.all([
        new Promise((resolve, reject) => chrome.storage.local.get( result => resolve(result))),
        new Promise((resolve, reject) => chrome.storage.sync.get(result => resolve(result)))
      ])
    .then(([localData, syncData]) => {

        delete syncData.Settings;
        const combinedData = Object.assign({}, localData, syncData);


        analyticsObject.settings={
            performanceSetting:combinedData.Settings.performanceSetting,
            showFoundWords: combinedData.Settings.showFoundWords,
            version: combinedData.Settings.version,
            license: combinedData.Settings.license,
            magicHighlighting: combinedData.Settings.magicHighlighting==undefined?true:combinedData.Settings.magicHighlighting

        }
        if(combinedData.Settings.backup){
          analyticsObject.settings.backup=combinedData.Settings.backup.frequency;
        }

        if(combinedData.Settings.neverHighlightOn){
          analyticsObject.settings.neverHighlightOn= (combinedData.Settings.neverHighlightOn.length>0)
        }


        var installId=combinedData.Settings.installId;
        delete combinedData.Settings;
        //get group analytics
        for (var groupId in combinedData) {
            var group = combinedData[groupId];
        
            if(group.storage=='local') {
                analyticsObject.numberOfLocalGroups+=1;
            }
            else {
                analyticsObject.numberOfSyncGroups+=1;

            }
            analyticsObject.numberOfWords += group.words.length;
            analyticsObject.useDetectCompleteWords=analyticsObject.useDetectCompleteWords||group.findWords;
            analyticsObject.useDetectPartialWords=analyticsObject.useDetectPartialWords||!group.findWords;
            analyticsObject.useOfRegex=analyticsObject.useOfRegex||group.regexTokens;
            analyticsObject.useOfCaseSensitive=analyticsObject.useOfCaseSensitive||group.caseSensitive;
            analyticsObject.useOfNotifications=analyticsObject.useOfNotifications||group.notifyOnHighlight;
            if(group.action) analyticsObject.useOfActions=analyticsObject.useOfActions||group.action.type!=0;
            analyticsObject.useOfInclusionRules=analyticsObject.useOfInclusionRules||group.showOn.length>0;
            analyticsObject.useOfExclusionRules=analyticsObject.useOfExclusionRules||group.dontShowOn.length>0;
            if(group.type=='remote'&&group.remoteConfig.type=='googleSheets') analyticsObject.sourceFromSheets=true;
            if(group.type=='remote'&&group.remoteConfig.type=='web') analyticsObject.sourceFromWeb=true;
            if(group.type=='remote'&&group.remoteConfig.type=='pastebin') analyticsObject.sourceFromPastebin=true;
            
        }
           

        const requestObject={
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            method: "POST",
            body: JSON.stringify(analyticsObject)
        }
        fetch(analyticsEndpoint+'/analytics/'+installId,requestObject)         
    
    });
   
}
function getBrowser() {
    if (typeof chrome !== "undefined") {
      if (typeof browser !== "undefined") {
        return "Firefox";
      } else {
        return "Chrome";
      }
    } else {
      return "Edge";
    }
  }